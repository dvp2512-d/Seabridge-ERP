import { prisma } from '@seabridge/database';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';

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
        dispatchMethod: options.dispatchMethod ?? null,
        shipmentType: options.shipmentType ?? null,
        variationPercent: options.variationPercent ?? null,
        totalValue: quotation.grandTotal,
        // Carry the quotation's currency across instead of defaulting to USD.
        currency: quotation.currency.code,
        paymentTerms: quotation.paymentTerms,
        deliveryTerms: quotation.deliveryTerms,
        notes: options.notes,
        items: {
          create: quotation.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
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
