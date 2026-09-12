import { prisma } from '@seabridge/database';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';
import { calculateInclusiveUnitPrices } from './inclusivePricing';

/**
 * Default export documentation checklist created with every new order.
 * Keeping this in one place means the Operations team always gets the same
 * checklist regardless of where the order was created from.
 */
const DEFAULT_DOCUMENT_CHECKLIST = [
  'COMMERCIAL_INVOICE',
  'PACKING_LIST',
  'BILL_OF_LADING',
  'CERTIFICATE_OF_ORIGIN',
  'PHYTOSANITARY',
];

export interface CreateOrderOptions {
  orderDate?: Date;
  expectedDate?: Date;
  poNumber?: string;
  /** Override the quotation's ports; otherwise they are inherited */
  portOfLoadingId?: string;
  portOfDischargeId?: string;
  notes?: string;
}

/** Units in which a quantity is itself a weight, and the factor to kilograms. */
const MASS_UNITS_IN_KG: Record<string, number> = {
  KG: 1,
  KGS: 1,
  MT: 1000,
  TON: 1000,
  TONS: 1000,
  TONNE: 1000,
  TONNES: 1000,
  G: 0.001,
  GM: 0.001,
  GRAM: 0.001,
  GRAMS: 0.001,
};

/**
 * Prefill an order line's packing figures from the quotation.
 *
 * These four figures are the Packing List and the weight block on every invoice.
 * Where packaging details aren't specified on the quotation, the fields stay null
 * and the document leaves those cells blank, which is a visible gap rather than
 * a plausible wrong number on a customs document.
 *
 * Operations can correct these per line afterwards; the figures below are a
 * starting point, not a substitute for weighing the shipment.
 */
function packingFromProduct(
  quantity: number,
  unit: string,
  _product: unknown,
  quoted: { packageType?: string | null; packageWeight?: unknown } = {}
) {
  const quotedWeight =
    quoted.packageWeight === null || quoted.packageWeight === undefined
      ? null
      : Number(quoted.packageWeight);

  const packageType = quoted.packageType ?? null;
  const perPackageNet = quotedWeight;

  // The net weight of goods sold by mass is the quantity itself.
  const factor = MASS_UNITS_IN_KG[unit.toUpperCase().trim()];
  const netWeight = factor === undefined ? null : quantity * factor;

  // Part-filled packages are rounded up: half a bag still ships as a bag.
  const numberOfPackages =
    perPackageNet && perPackageNet > 0 && netWeight !== null
      ? Math.ceil(netWeight / perPackageNet)
      : null;

  return {
    numberOfPackages,
    // The type comes along with the figures: a package count is only actionable
    // alongside what the packages are.
    packageType,
    packageWeight: perPackageNet,
    netWeight,
    grossWeight: null, // Gross weight must be entered manually per order
  };
}

/**
 * Fill an order's packing figures from what is already on file.
 *
 * New orders get these when the quotation is converted, but an order created before
 * the packaging fields existed - or one whose product had no packaging set at the
 * time - has empty lines, and the packing list prints blank however complete the rest
 * of the order is. This fills them from the two sources that already know: the
 * packing agreed on the quotation, and the product's standard pack.
 *
 * By default it only fills what is empty, so figures someone has weighed and entered
 * are never overwritten by a computed guess. `overwrite` recalculates every line, for
 * when a product's packaging has been corrected and the orders should follow.
 *
 * Returns what it did rather than throwing on lines it cannot fill: a product with no
 * packaging on file has nothing to fetch, and that is worth reporting rather than
 * treating as a failure.
 */
export async function fillOrderPacking(
  orderId: string,
  options: { overwrite?: boolean } = {}
): Promise<{ filled: number; skipped: number; unavailable: string[] }> {
  const order = await prisma.exportOrder.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: true } },
      // The packing the buyer agreed to, which outranks the product's default.
      quotation: { include: { items: true } },
    },
  });

  if (!order) return { filled: 0, skipped: 0, unavailable: [] };

  let filled = 0;
  let skipped = 0;
  const unavailable: string[] = [];

  for (const item of order.items) {
    /**
     * Whether someone has actually declared this line's packing.
     *
     * Net weight is deliberately not part of the test: it is derived from the
     * quantity whenever goods are sold by mass, so every line has one from the moment
     * it is created. Counting it as "already set" would mean a line whose packages,
     * type and gross weight are all empty could never be filled - which is exactly
     * what happened before this was corrected.
     *
     * The three below cannot be derived from a quantity, so their presence is
     * evidence of a human decision worth preserving.
     */
    const alreadySet =
      item.numberOfPackages !== null || item.grossWeight !== null || item.packageType !== null;

    if (alreadySet && !options.overwrite) {
      skipped += 1;
      continue;
    }

    // Matched on product: a quotation line and an order line for the same product are
    // the same line, since an order is created one-for-one from its quotation.
    const quoted = order.quotation?.items.find((q) => q.productId === item.productId);

    const packing = packingFromProduct(Number(item.quantity), item.unit, item.product, {
      packageType: quoted?.packageType ?? null,
      packageWeight: quoted?.packageWeight ?? null,
    });

    // Nothing on file to fetch from - no agreed packing and no product default.
    if (
      packing.packageType === null &&
      packing.numberOfPackages === null &&
      packing.netWeight === null
    ) {
      unavailable.push(item.product.name);
      continue;
    }

    await prisma.orderItem.update({
      where: { id: item.id },
      data: packing,
    });
    filled += 1;
  }

  return { filled, skipped, unavailable };
}

/**
 * Convert an accepted quotation into an export order.
 *
 * Runs inside a single transaction so a partial failure can never leave an
 * order without items or a quotation marked accepted with no order attached.
 */
export async function createOrderFromQuotation(
  quotationId: string,
  options: CreateOrderOptions = {}
) {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      // Products come along because their default packaging prefills the order
      // lines, which is what the Packing List is built from.
      items: { include: { product: true } },
      costs: true,
    },
  });

  if (!quotation) throw new NotFoundError('Quotation');

  if (quotation.items.length === 0) {
    throw new AppError('Cannot create an order from a quotation with no items', 400);
  }

  // Guard against creating two orders from the same quotation by mistake.
  const existingOrder = await prisma.exportOrder.findFirst({
    where: { quotationId },
    select: { id: true, orderNumber: true },
  });
  if (existingOrder) {
    throw new AppError(
      `Order ${existingOrder.orderNumber} already exists for this quotation`,
      409
    );
  }

  const orderNumber = await generateCode('ORDER', 'ORD');

  /**
   * Fold the quotation's additional costs into the unit prices.
   *
   * The quotation keeps the goods price and the cost rows separate, which is what
   * makes margin measurable per line. An order cannot: it carries a single
   * totalValue, and a commercial invoice built from it must show lines that sum
   * to that total or customs will query the discrepancy. So the order stores the
   * all-inclusive figure - goods price plus the costs spread per unit - and the
   * quotation keeps the breakdown.
   *
   * Costs are spread evenly per unit rather than by line value. They are
   * overwhelmingly freight and handling, which follow weight and volume rather
   * than what the goods are worth; loading them by value inflates an expensive
   * line and under-recovers on a cheap one.
   */
  const additionalCosts = quotation.costs.reduce((sum, c) => sum + Number(c.amount), 0);
  const pricing = calculateInclusiveUnitPrices(
    quotation.items.map((item) => ({
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
    })),
    additionalCosts
  );

  // Where a per-unit cost cannot be expressed exactly - spreading 137.77 across
  // 25,000 units, say - the order total ends a few paise from the quotation's.
  // That is logged rather than refused: blocking a legitimate order over a
  // rounding difference would be worse than the difference itself.
  if (!pricing.reconciled) {
    console.warn(
      `[order] ${quotation.quotationNumber}: additional costs leave a rounding remainder of ` +
        `${pricing.remainder}; order total is ${pricing.total}`
    );
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.exportOrder.create({
      data: {
        orderNumber,
        quotationId: quotation.id,
        buyerId: quotation.buyerId,
        incotermId: quotation.incotermId,
        poNumber: options.poNumber || null,
        orderDate: options.orderDate ?? new Date(),
        expectedDate: options.expectedDate ?? null,
        // Carried across so invoices and packing lists can print the ports
        // before any shipment record exists.
        portOfLoadingId: options.portOfLoadingId ?? quotation.portOfLoadingId ?? null,
        portOfDischargeId: options.portOfDischargeId ?? quotation.portOfDischargeId ?? null,
        // Equals the sum of the line amounts below, which is the quotation's
        // grandTotal once rounding has reconciled.
        totalValue: pricing.total,
        paymentTerms: quotation.paymentTerms,
        deliveryTerms: quotation.deliveryTerms,
        // Printed in the shipment strip of every document raised against this
        // order. Carried over so an invoice does not have to guess them from the
        // port type before a shipment has been booked.
        dispatchMethod: quotation.dispatchMethod,
        shipmentType: quotation.shipmentType,
        notes: options.notes,
        items: {
          // pricing.lines is built by mapping quotation.items in order, so the
          // indexes line up.
          create: quotation.items.map((item, index) => ({
            productId: item.productId,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: pricing.lines[index].unitPrice,
            totalPrice: pricing.lines[index].amount,
            notes: item.specifications,
            ...packingFromProduct(Number(item.quantity), item.unit, item.product, {
              packageType: item.packageType,
              packageWeight: item.packageWeight,
            }),
          })),
        },
        documents: {
          create: DEFAULT_DOCUMENT_CHECKLIST.map((documentType) => ({
            documentType,
            status: 'PENDING',
          })),
        },
      },
      include: {
        buyer: true,
        incoterm: true,
        items: { include: { product: true } },
        documents: true,
      },
    });

    // Mark the quotation as accepted (it is now a firm order).
    await tx.quotation.update({
      where: { id: quotation.id },
      data: {
        status: 'ACCEPTED',
        acceptedAt: quotation.acceptedAt ?? new Date(),
      },
    });

    // Close the originating inquiry as won.
    if (quotation.inquiryId) {
      await tx.inquiry.update({
        where: { id: quotation.inquiryId },
        data: { stage: 'WON', closedAt: new Date() },
      });
    }

    // Keep buyer rollups current for the dashboard.
    await tx.buyer.update({
      where: { id: quotation.buyerId },
      data: {
        totalOrders: { increment: 1 },
        lastOrderDate: new Date(),
        status: 'ACTIVE',
      },
    });

    return order;
  });
}
