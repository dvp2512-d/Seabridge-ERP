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
  /** Sea / Air / Road - printed in the header of every export document */
  dispatchMethod?: string;
  /** FCL / LCL / Sample Shipment */
  shipmentType?: string;
  /** Override the quotation's ports; otherwise they are inherited */
  portOfLoadingId?: string;
  portOfDischargeId?: string;
  /** Quantity tolerance printed on proforma and commercial invoices */
  variationPercent?: number;
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
      currency: true,
      // Needed to fold the additional costs into the order's unit prices, so the
      // order lines sum to its own total.
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

  /**
   * Fold the quotation's additional costs into the unit prices.
   *
   * The buyer was quoted one all-inclusive figure per unit, so that is what the
   * order carries. Doing it here rather than at print time means the order's
   * lines sum to its own totalValue, and every document built from the order
   * inherits figures that reconcile.
   */
  const additionalCosts = quotation.costs.reduce((sum, c) => sum + Number(c.amount), 0);
  const pricing = calculateInclusiveUnitPrices(
    quotation.items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
    })),
    additionalCosts
  );

  // The order's own lines always sum to its totalValue, which is the fault being
  // fixed. Where a per-unit cost cannot be expressed exactly - spreading 137.77
  // across 25,000 units, say - the order total ends a few paise from the
  // quotation's, and that is logged rather than refused. Blocking the order over
  // a rounding difference would be worse than the difference.
  if (!pricing.reconciled) {
    console.warn(
      `[order] ${quotation.quotationNumber}: additional costs leave a rounding remainder of ${pricing.remainder}; order total is ${pricing.total}`
    );
  }

  const orderNumber = await generateCode('ORDER', 'ORD');

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
        // Copy shipping details from quotation, allow override from options
        dispatchMethod: options.dispatchMethod ?? quotation.dispatchMethod ?? null,
        shipmentType: options.shipmentType ?? quotation.shipmentType ?? null,
        // Carried across so invoices and packing lists can print the ports
        // before any shipment record exists.
        portOfLoadingId: options.portOfLoadingId ?? quotation.portOfLoadingId ?? null,
        portOfDischargeId: options.portOfDischargeId ?? quotation.portOfDischargeId ?? null,
        variationPercent: options.variationPercent ?? null,
        // Equals the sum of the line amounts above, which is the same figure as
        // the quotation's grandTotal once rounding has reconciled.
        totalValue: pricing.total,
        // Carry the quotation's currency across instead of defaulting to USD.
        currency: quotation.currency.code,
        paymentTerms: quotation.paymentTerms,
        deliveryTerms: quotation.deliveryTerms,
        notes: options.notes,
        items: {
          create: pricing.lines.map((line) => ({
            productId: line.item.productId,
            quantity: line.item.quantity,
            unit: line.item.unit,
            /**
             * All-inclusive: goods price plus the additional costs spread per
             * unit. Previously the goods-only price was copied while totalValue
             * carried the costs, so the order's lines did not sum to its own
             * total and the commercial invoice printed lines that disagreed with
             * its total.
             */
            unitPrice: line.unitPrice,
            totalPrice: line.amount,
            notes: line.item.specifications,
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
