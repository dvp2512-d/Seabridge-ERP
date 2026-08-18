/**
 * Cancelling business documents.
 *
 * Inquiries, quotations, orders and invoices are numbered records. Deleting one
 * leaves a gap in the numbering that an accountant or customs officer will ask
 * about, and the audit log would show a record that no longer exists. So they are
 * marked void instead, keeping their number.
 *
 * The guards here are the point of the module. Each blocks a cancellation that
 * would contradict something that already happened - money received, goods
 * shipped, an order raised - because at that stage the document is a record of
 * fact rather than an intention.
 */
import { prisma } from '@seabridge/database';
import { AppError } from '../middleware/errorHandler';

export interface CancelResult {
  id: string;
  status: string;
  message: string;
}

/**
 * Invoice: blocked once any payment has been received.
 *
 * A cancelled invoice with payments against it would leave the buyer's ledger
 * showing money paid against nothing, and the receivables total would disagree
 * with the bank.
 */
export async function cancelInvoice(id: string, reason?: string): Promise<CancelResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: { select: { id: true } } },
  });
  if (!invoice) throw new AppError('Invoice not found', 404);

  if (invoice.status === 'CANCELLED') {
    throw new AppError('This invoice is already cancelled', 400);
  }

  if (invoice.payments.length > 0) {
    throw new AppError(
      `This invoice has ${invoice.payments.length} payment${
        invoice.payments.length === 1 ? '' : 's'
      } recorded against it, so cancelling would leave the buyer's ledger inconsistent. Reverse the payments first, or issue a credit note.`,
      400
    );
  }

  if (Number(invoice.paidAmount) > 0) {
    throw new AppError(
      'This invoice shows an amount paid, so it cannot be cancelled. Issue a credit note instead.',
      400
    );
  }

  const updated = await prisma.invoice.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      // Keep the reason with the record rather than only in the audit log, so it
      // is visible on the invoice itself.
      notes: reason ? `${invoice.notes ? invoice.notes + '\n\n' : ''}Cancelled: ${reason}` : invoice.notes,
      // A cancelled invoice is owed nothing, so it must drop out of receivables.
      balanceAmount: 0,
    },
  });

  return {
    id: updated.id,
    status: updated.status,
    message: `Invoice ${invoice.invoiceNumber} cancelled. The number is retained and it no longer counts towards receivables.`,
  };
}

/**
 * Order: blocked once goods have shipped.
 *
 * After shipping there is a container in transit and usually an invoice, so
 * cancelling would misrepresent what physically happened.
 */
export async function cancelOrder(id: string, reason?: string): Promise<CancelResult> {
  const order = await prisma.exportOrder.findUnique({
    where: { id },
    include: {
      invoices: { where: { status: { not: 'CANCELLED' } }, select: { id: true, invoiceNumber: true } },
      shipments: { select: { id: true, status: true } },
    },
  });
  if (!order) throw new AppError('Order not found', 404);

  if (order.status === 'CANCELLED') {
    throw new AppError('This order is already cancelled', 400);
  }

  if (['SHIPPED', 'DELIVERED'].includes(order.status)) {
    throw new AppError(
      `This order is already ${order.status.toLowerCase()}, so it cannot be cancelled. The goods have left.`,
      400
    );
  }

  const movedShipments = order.shipments.filter(
    (s) => s.status && !['PENDING', 'CANCELLED'].includes(s.status)
  );
  if (movedShipments.length > 0) {
    throw new AppError(
      'A shipment on this order is already booked or in transit. Cancel the shipment first.',
      400
    );
  }

  if (order.invoices.length > 0) {
    throw new AppError(
      `This order has been invoiced (${order.invoices
        .map((i) => i.invoiceNumber)
        .join(', ')}). Cancel the invoice first so the two cannot disagree.`,
      400
    );
  }

  const updated = await prisma.exportOrder.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      notes: reason ? `${order.notes ? order.notes + '\n\n' : ''}Cancelled: ${reason}` : order.notes,
    },
  });

  return {
    id: updated.id,
    status: updated.status,
    message: `Order ${order.orderNumber} cancelled.`,
  };
}

/**
 * Quotation: blocked once it has become an order.
 *
 * The order is the agreement that followed; voiding its origin would leave the
 * order descended from a rejected document.
 */
export async function cancelQuotation(id: string, reason?: string): Promise<CancelResult> {
  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: {
      orders: { where: { status: { not: 'CANCELLED' } }, select: { id: true, orderNumber: true } },
    },
  });
  if (!quotation) throw new AppError('Quotation not found', 404);

  if (quotation.status === 'REJECTED') {
    throw new AppError('This quotation is already rejected', 400);
  }

  if (quotation.orders.length > 0) {
    throw new AppError(
      `This quotation was converted to order ${quotation.orders[0].orderNumber}. Cancel that order first.`,
      400
    );
  }

  const updated = await prisma.quotation.update({
    where: { id },
    data: {
      status: 'REJECTED',
      notes: reason
        ? `${quotation.notes ? quotation.notes + '\n\n' : ''}Cancelled: ${reason}`
        : quotation.notes,
    },
  });

  return {
    id: updated.id,
    status: updated.status,
    message: `Quotation ${quotation.quotationNumber} marked rejected.`,
  };
}

/**
 * Inquiry: marked lost rather than cancelled, which is the language the sales
 * pipeline already uses.
 */
export async function cancelInquiry(id: string, reason?: string): Promise<CancelResult> {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id },
    include: {
      quotations: {
        where: { status: { notIn: ['REJECTED', 'EXPIRED'] } },
        select: { id: true, quotationNumber: true },
      },
    },
  });
  if (!inquiry) throw new AppError('Inquiry not found', 404);

  if (inquiry.stage === 'LOST') {
    throw new AppError('This inquiry is already marked lost', 400);
  }

  if (inquiry.stage === 'WON') {
    throw new AppError(
      'This inquiry was won, so it cannot be marked lost. Cancel the quotation or order instead.',
      400
    );
  }

  if (inquiry.quotations.length > 0) {
    throw new AppError(
      `This inquiry has a live quotation (${inquiry.quotations[0].quotationNumber}). Cancel it first.`,
      400
    );
  }

  const updated = await prisma.inquiry.update({
    where: { id },
    data: {
      stage: 'LOST',
      lostReason: reason ?? undefined,
    },
  });

  return {
    id: updated.id,
    status: updated.stage,
    message: `Inquiry ${inquiry.inquiryNumber} marked lost.`,
  };
}

/**
 * Genuine deletion of a draft quotation.
 *
 * Only a DRAFT with no order attached: nothing has been sent to a buyer and
 * nothing references it, so removing it loses no history. Anything further along
 * is cancelled rather than deleted.
 */
export async function deleteDraftQuotation(id: string): Promise<{ id: string; message: string }> {
  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: { orders: { select: { id: true } } },
  });
  if (!quotation) throw new AppError('Quotation not found', 404);

  if (quotation.status !== 'DRAFT') {
    throw new AppError(
      `Only a draft can be deleted. This quotation is ${quotation.status}, so cancel it instead - that keeps its number.`,
      400
    );
  }

  if (quotation.orders.length > 0) {
    throw new AppError('This quotation has an order attached and cannot be deleted', 400);
  }

  // Items and costs cascade from the quotation, so one delete is enough.
  await prisma.quotation.delete({ where: { id } });

  return { id, message: `Draft ${quotation.quotationNumber} deleted.` };
}
