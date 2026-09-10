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
      items: true,
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
