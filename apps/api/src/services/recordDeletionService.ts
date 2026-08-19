/**
 * Permanent deletion of business records, founder only.
 *
 * The database will not allow a record to be removed while other rows point at
 * it. From the init migration:
 *
 *   inquiries      <- items, follow-ups   CASCADE   (removed automatically)
 *                  <- quotations          SET NULL  (detach, keep the quotation)
 *   quotations     <- items, costs         CASCADE
 *                  <- export_orders        RESTRICT  (must be removed first)
 *   export_orders  <- items, documents     CASCADE
 *                  <- procurements,
 *                     shipments, invoices  RESTRICT  (must be removed first)
 *   invoices       <- payments             RESTRICT  (must be removed first)
 *   expenses       <- nothing
 *
 * So deleting a quotation that became an order genuinely means deleting the
 * order, its invoices and their payments. There is no way to remove only the
 * quotation at that stage - the database refuses.
 *
 * Every deletion runs in one transaction, so a partial failure cannot leave
 * orphaned children or a buyer's revenue disagreeing with their payments.
 *
 * Buyer revenue is RECOMPUTED from the surviving payments rather than
 * decremented. Decrementing would drift, because the original increments were
 * converted at the rate in force on each payment date.
 */
import { prisma } from '@seabridge/database';
import { AppError } from '../middleware/errorHandler';

export interface DeletionImpact {
  label: string;
  count: number;
  /** Money that will disappear from reported figures, if any */
  amount?: number;
  currency?: string;
}

export interface DeletionPreview {
  recordLabel: string;
  impacts: DeletionImpact[];
  /** Buyers whose revenue total will be recalculated */
  affectedBuyerIds: string[];
  blocked: string | null;
}

/** Recompute a buyer's revenue from whatever payments remain. */
async function recomputeBuyerRevenue(tx: any, buyerId: string): Promise<void> {
  const invoices = await tx.invoice.findMany({
    where: { buyerId },
    select: { id: true, exchangeRate: true },
  });

  let total = 0;
  for (const invoice of invoices) {
    const sum = await tx.payment.aggregate({
      where: { invoiceId: invoice.id },
      _sum: { amount: true },
    });
    // Each invoice carries the rate it was issued under, which is the same basis
    // the original increments used.
    total += Number(sum._sum.amount ?? 0) * Number(invoice.exchangeRate ?? 1);
  }

  await tx.buyer.update({
    where: { id: buyerId },
    data: { totalRevenue: Math.round((total + Number.EPSILON) * 100) / 100 },
  });
}

// ---------------------------------------------------------------- previews

export async function previewInvoiceDeletion(id: string): Promise<DeletionPreview> {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      payments: { select: { amount: true } },
      currency: { select: { code: true } },
    },
  });
  if (!invoice) throw new AppError('Invoice not found', 404);

  const paid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
  const impacts: DeletionImpact[] = [{ label: 'invoice', count: 1 }];
  if (invoice.payments.length > 0) {
    impacts.push({
      label: invoice.payments.length === 1 ? 'payment' : 'payments',
      count: invoice.payments.length,
      amount: paid,
      currency: invoice.currency?.code,
    });
  }

  return {
    recordLabel: invoice.invoiceNumber,
    impacts,
    affectedBuyerIds: [invoice.buyerId],
    blocked: null,
  };
}

export async function previewOrderDeletion(id: string): Promise<DeletionPreview> {
  const order = await prisma.exportOrder.findUnique({
    where: { id },
    include: {
      invoices: { include: { payments: { select: { amount: true } }, currency: true } },
      shipments: { select: { id: true } },
      procurements: { select: { id: true } },
      items: { select: { id: true } },
    },
  });
  if (!order) throw new AppError('Order not found', 404);

  const payments = order.invoices.flatMap((i) => i.payments);
  const paid = payments.reduce((s, p) => s + Number(p.amount), 0);

  const impacts: DeletionImpact[] = [{ label: 'order', count: 1 }];
  if (order.items.length) impacts.push({ label: 'order lines', count: order.items.length });
  if (order.invoices.length) impacts.push({ label: 'invoices', count: order.invoices.length });
  if (payments.length) {
    impacts.push({
      label: payments.length === 1 ? 'payment' : 'payments',
      count: payments.length,
      amount: paid,
      currency: order.invoices[0]?.currency?.code,
    });
  }
  if (order.shipments.length) impacts.push({ label: 'shipments', count: order.shipments.length });
  if (order.procurements.length) {
    impacts.push({ label: 'procurements', count: order.procurements.length });
  }

  return {
    recordLabel: order.orderNumber,
    impacts,
    affectedBuyerIds: [order.buyerId],
    blocked: null,
  };
}

export async function previewQuotationDeletion(id: string): Promise<DeletionPreview> {
  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: {
      items: { select: { id: true } },
      orders: {
        include: {
          invoices: { include: { payments: { select: { amount: true } }, currency: true } },
          shipments: { select: { id: true } },
          procurements: { select: { id: true } },
        },
      },
    },
  });
  if (!quotation) throw new AppError('Quotation not found', 404);

  const invoices = quotation.orders.flatMap((o) => o.invoices);
  const payments = invoices.flatMap((i) => i.payments);
  const paid = payments.reduce((s, p) => s + Number(p.amount), 0);

  const impacts: DeletionImpact[] = [{ label: 'quotation', count: 1 }];
  if (quotation.items.length) impacts.push({ label: 'quotation lines', count: quotation.items.length });
  if (quotation.orders.length) impacts.push({ label: 'orders', count: quotation.orders.length });
  if (invoices.length) impacts.push({ label: 'invoices', count: invoices.length });
  if (payments.length) {
    impacts.push({
      label: payments.length === 1 ? 'payment' : 'payments',
      count: payments.length,
      amount: paid,
      currency: invoices[0]?.currency?.code,
    });
  }
  const shipments = quotation.orders.flatMap((o) => o.shipments);
  if (shipments.length) impacts.push({ label: 'shipments', count: shipments.length });

  return {
    recordLabel: quotation.quotationNumber,
    impacts,
    affectedBuyerIds: [quotation.buyerId],
    blocked: null,
  };
}

export async function previewInquiryDeletion(id: string): Promise<DeletionPreview> {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id },
    include: {
      items: { select: { id: true } },
      quotations: { select: { id: true, quotationNumber: true } },
    },
  });
  if (!inquiry) throw new AppError('Inquiry not found', 404);

  const impacts: DeletionImpact[] = [{ label: 'inquiry', count: 1 }];
  if (inquiry.items.length) impacts.push({ label: 'inquiry lines', count: inquiry.items.length });

  return {
    recordLabel: inquiry.inquiryNumber,
    impacts,
    affectedBuyerIds: [],
    // Quotations detach rather than being destroyed, which is worth stating.
    blocked: null,
  };
}

export async function previewExpenseDeletion(id: string): Promise<DeletionPreview> {
  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) throw new AppError('Expense not found', 404);

  return {
    recordLabel: expense.expenseNumber,
    impacts: [{ label: 'expense', count: 1, amount: Number(expense.amount), currency: expense.currency }],
    affectedBuyerIds: [],
    blocked: null,
  };
}

// ---------------------------------------------------------------- deletions

/** Remove one invoice and its payments, then restate the buyer's revenue. */
export async function deleteInvoiceCascade(id: string): Promise<{ label: string }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, invoiceNumber: true, buyerId: true },
  });
  if (!invoice) throw new AppError('Invoice not found', 404);

  await prisma.$transaction(async (tx) => {
    await tx.payment.deleteMany({ where: { invoiceId: id } });
    await tx.invoice.delete({ where: { id } });
    await recomputeBuyerRevenue(tx, invoice.buyerId);
  });

  return { label: invoice.invoiceNumber };
}

/**
 * Remove one order with everything the database requires to go with it.
 * Order lines and documents cascade; invoices, payments, shipments and
 * procurements must be removed explicitly.
 */
export async function deleteOrderCascade(id: string): Promise<{ label: string }> {
  const order = await prisma.exportOrder.findUnique({
    where: { id },
    select: { id: true, orderNumber: true, buyerId: true, invoices: { select: { id: true } } },
  });
  if (!order) throw new AppError('Order not found', 404);

  await prisma.$transaction(async (tx) => {
    const invoiceIds = order.invoices.map((i) => i.id);
    if (invoiceIds.length) {
      await tx.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
    await tx.shipment.deleteMany({ where: { orderId: id } });
    await tx.procurement.deleteMany({ where: { orderId: id } });
    await tx.exportOrder.delete({ where: { id } });
    await recomputeBuyerRevenue(tx, order.buyerId);
  });

  return { label: order.orderNumber };
}

/** Remove a quotation, plus any orders that came from it and their descendants. */
export async function deleteQuotationCascade(id: string): Promise<{ label: string }> {
  const quotation = await prisma.quotation.findUnique({
    where: { id },
    select: {
      id: true,
      quotationNumber: true,
      buyerId: true,
      orders: { select: { id: true, invoices: { select: { id: true } } } },
    },
  });
  if (!quotation) throw new AppError('Quotation not found', 404);

  await prisma.$transaction(async (tx) => {
    for (const order of quotation.orders) {
      const invoiceIds = order.invoices.map((i) => i.id);
      if (invoiceIds.length) {
        await tx.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }
      await tx.shipment.deleteMany({ where: { orderId: order.id } });
      await tx.procurement.deleteMany({ where: { orderId: order.id } });
      await tx.exportOrder.delete({ where: { id: order.id } });
    }
    await tx.quotation.delete({ where: { id } });
    await recomputeBuyerRevenue(tx, quotation.buyerId);
  });

  return { label: quotation.quotationNumber };
}

/**
 * Remove an inquiry. Its items and follow-ups cascade; any quotation raised from
 * it survives with its inquiry link cleared, because the quotation is a separate
 * agreement and destroying it was not asked for.
 */
export async function deleteInquiryCascade(id: string): Promise<{ label: string }> {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id },
    select: { id: true, inquiryNumber: true },
  });
  if (!inquiry) throw new AppError('Inquiry not found', 404);

  await prisma.inquiry.delete({ where: { id } });
  return { label: inquiry.inquiryNumber };
}
