/**
 * Permanent deletion of business records. Founder only.
 *
 * Kept in its own router so the five record types share one implementation and
 * one permission check, rather than each route file growing its own variant.
 *
 * Two endpoints per type:
 *   GET  .../preview  what will be destroyed, so the user can be told first
 *   DELETE ...        do it, in a single transaction
 *
 * The preview is deliberately a separate call: these deletions cascade through
 * orders, invoices and payments, and a confirmation that cannot say what it is
 * about to destroy is not really a confirmation.
 */
import { Router } from 'express';
import { authenticate, can } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import {
  previewInquiryDeletion,
  previewQuotationDeletion,
  previewOrderDeletion,
  previewInvoiceDeletion,
  previewExpenseDeletion,
  deleteInquiryCascade,
  deleteQuotationCascade,
  deleteOrderCascade,
  deleteInvoiceCascade,
} from '../services/recordDeletionService';
import { prisma } from '@seabridge/database';

const router: Router = Router();

router.use(authenticate);

type Handler = {
  preview: (id: string) => Promise<any>;
  remove: (id: string) => Promise<{ label: string }>;
};

const HANDLERS: Record<string, Handler> = {
  inquiries: { preview: previewInquiryDeletion, remove: deleteInquiryCascade },
  quotations: { preview: previewQuotationDeletion, remove: deleteQuotationCascade },
  orders: { preview: previewOrderDeletion, remove: deleteOrderCascade },
  invoices: { preview: previewInvoiceDeletion, remove: deleteInvoiceCascade },
  expenses: {
    preview: previewExpenseDeletion,
    // Nothing references an expense, so no cascade is needed.
    remove: async (id: string) => {
      const expense = await prisma.expense.findUnique({ where: { id } });
      if (!expense) throw new AppError('Expense not found', 404);
      await prisma.expense.delete({ where: { id } });
      return { label: expense.expenseNumber };
    },
  },
};

function resolve(resource: string): Handler {
  const handler = HANDLERS[resource];
  if (!handler) {
    throw new AppError(
      `"${resource}" cannot be deleted here. Supported: ${Object.keys(HANDLERS).join(', ')}.`,
      400
    );
  }
  return handler;
}

/**
 * What deleting would destroy. Read-only, so it needs only view permission - the
 * confirmation dialog calls this before asking the user to commit.
 */
router.get('/:resource/:id/preview', can('OPERATIONS_VIEW'), async (req, res, next) => {
  try {
    const handler = resolve(req.params.resource);
    const preview = await handler.preview(req.params.id);
    res.json({ success: true, data: preview });
  } catch (error) {
    next(error);
  }
});

/**
 * Delete permanently.
 *
 * RECORD_DELETE is founder-only. This is the security boundary: hiding the button
 * in the UI is presentation, and a direct API call from any other role is refused
 * here regardless.
 */
router.delete('/:resource/:id', can('RECORD_DELETE'), async (req, res, next) => {
  try {
    const handler = resolve(req.params.resource);
    const result = await handler.remove(req.params.id);
    res.json({
      success: true,
      data: { id: req.params.id },
      message: `${result.label} deleted permanently.`,
    });
  } catch (error) {
    next(error);
  }
});

export { router as recordDeletionRouter };
