/**
 * Bulk Operations Routes
 * 
 * Provides bulk update/delete operations for various modules.
 * 
 * IMPORTANT: All status/stage updates respect the same state machine transitions
 * as individual updates. Invalid transitions are rejected with clear error messages.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError, AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router: Router = Router();

router.use(authenticate);

/**
 * Order status state machine.
 * Mirrors the validation in orders.ts to ensure consistency.
 */
const ORDER_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  'CONFIRMED': ['IN_PRODUCTION', 'CANCELLED'],
  'IN_PRODUCTION': ['READY_TO_SHIP', 'CANCELLED'],
  'READY_TO_SHIP': ['SHIPPED', 'CANCELLED'],
  'SHIPPED': ['DELIVERED', 'CANCELLED'],
  'DELIVERED': [], // Terminal state
  'CANCELLED': [], // Terminal state
};

/**
 * Inquiry stage state machine.
 * Mirrors the validation in inquiries.ts to ensure consistency.
 */
const INQUIRY_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  'NEW': ['REQUIREMENT_GATHERED', 'ON_HOLD', 'LOST'],
  'REQUIREMENT_GATHERED': ['PRICING_IN_PROGRESS', 'ON_HOLD', 'LOST'],
  'PRICING_IN_PROGRESS': ['QUOTATION_SENT', 'ON_HOLD', 'LOST'],
  'QUOTATION_SENT': ['NEGOTIATION', 'WON', 'LOST', 'ON_HOLD'],
  'NEGOTIATION': ['WON', 'LOST', 'ON_HOLD', 'QUOTATION_SENT'],
  'ON_HOLD': ['NEW', 'REQUIREMENT_GATHERED', 'PRICING_IN_PROGRESS', 'QUOTATION_SENT', 'NEGOTIATION', 'LOST'],
  'WON': [], // Terminal state
  'LOST': [], // Terminal state
};

/**
 * Invoice status state machine.
 * Mirrors the validation in invoices.ts to ensure consistency.
 */
const INVOICE_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  'DRAFT': ['SENT', 'CANCELLED'],
  'SENT': ['OVERDUE', 'CANCELLED'], // PAID/PARTIALLY_PAID only via payments
  'PARTIALLY_PAID': ['OVERDUE', 'CANCELLED'], // PAID only via payments
  'OVERDUE': ['SENT', 'CANCELLED'], // Can mark reminders sent
  'PAID': [], // Terminal state
  'CANCELLED': [], // Terminal state
};

// Bulk update order status
router.put('/orders/status', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      ids: z.array(z.string()).min(1).max(100),
      status: z.enum(['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'CANCELLED']),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const { ids, status } = validation.data;

    // Fetch current status of all orders to validate transitions
    const orders = await prisma.exportOrder.findMany({
      where: { id: { in: ids } },
      select: { id: true, orderNumber: true, status: true },
    });

    if (orders.length === 0) {
      throw new AppError('No orders found with the provided IDs', 404);
    }

    // Validate all transitions before updating any
    const invalidTransitions: string[] = [];
    const validIds: string[] = [];

    for (const order of orders) {
      const allowed = ORDER_ALLOWED_TRANSITIONS[order.status] || [];
      if (order.status === status) {
        // Already in target status, skip but don't error
        continue;
      }
      if (!allowed.includes(status)) {
        invalidTransitions.push(
          `${order.orderNumber}: cannot change from ${order.status} to ${status}`
        );
      } else {
        validIds.push(order.id);
      }
    }

    if (invalidTransitions.length > 0 && validIds.length === 0) {
      throw new AppError(
        `No valid transitions. Invalid: ${invalidTransitions.join('; ')}`,
        400
      );
    }

    // Update only the orders with valid transitions
    const result = await prisma.exportOrder.updateMany({
      where: { id: { in: validIds } },
      data: { status },
    });

    logger.info('Bulk order status update', { 
      count: result.count, 
      status, 
      userId: req.user!.id,
      skipped: invalidTransitions.length,
    });

    res.json({
      success: true,
      data: { 
        updated: result.count,
        ...(invalidTransitions.length > 0 && { 
          skipped: invalidTransitions.length,
          invalidTransitions,
        }),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Bulk update invoice status
router.put('/invoices/status', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      ids: z.array(z.string()).min(1).max(100),
      status: z.enum(['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED']),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const { ids, status } = validation.data;

    // Don't allow bulk status changes that skip payment tracking
    if (status === 'PAID') {
      throw new AppError('Cannot bulk-mark invoices as PAID. Use payment recording instead.', 400);
    }
    if (status === 'PARTIALLY_PAID') {
      throw new AppError('Cannot bulk-mark invoices as PARTIALLY_PAID. Record payments instead.', 400);
    }

    // Fetch current status of all invoices to validate transitions
    const invoices = await prisma.invoice.findMany({
      where: { id: { in: ids } },
      select: { id: true, invoiceNumber: true, status: true },
    });

    if (invoices.length === 0) {
      throw new AppError('No invoices found with the provided IDs', 404);
    }

    // Validate all transitions before updating any
    const invalidTransitions: string[] = [];
    const validIds: string[] = [];

    for (const invoice of invoices) {
      const allowed = INVOICE_ALLOWED_TRANSITIONS[invoice.status] || [];
      if (invoice.status === status) {
        // Already in target status, skip but don't error
        continue;
      }
      if (!allowed.includes(status)) {
        invalidTransitions.push(
          `${invoice.invoiceNumber}: cannot change from ${invoice.status} to ${status}`
        );
      } else {
        validIds.push(invoice.id);
      }
    }

    if (invalidTransitions.length > 0 && validIds.length === 0) {
      throw new AppError(
        `No valid transitions. Invalid: ${invalidTransitions.join('; ')}`,
        400
      );
    }

    // Update only the invoices with valid transitions
    const updateData: any = { status };
    if (status === 'SENT') {
      updateData.sentAt = new Date();
    }

    const result = await prisma.invoice.updateMany({
      where: { id: { in: validIds } },
      data: updateData,
    });

    logger.info('Bulk invoice status update', { 
      count: result.count, 
      status, 
      userId: req.user!.id,
      skipped: invalidTransitions.length,
    });

    res.json({
      success: true,
      data: { 
        updated: result.count,
        ...(invalidTransitions.length > 0 && { 
          skipped: invalidTransitions.length,
          invalidTransitions,
        }),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Bulk approve expenses
router.put('/expenses/approve', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      ids: z.array(z.string()).min(1).max(100),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const { ids } = validation.data;

    // Only approve PENDING expenses - this is already correct behavior
    const result = await prisma.expense.updateMany({
      where: { 
        id: { in: ids },
        status: 'PENDING',
      },
      data: { status: 'APPROVED' },
    });

    logger.info('Bulk expense approval', { count: result.count, userId: req.user!.id });

    res.json({
      success: true,
      data: { approved: result.count },
    });
  } catch (error) {
    next(error);
  }
});

// Bulk update inquiry stage
router.put('/inquiries/stage', can('SALES_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      ids: z.array(z.string()).min(1).max(100),
      stage: z.enum(['NEW', 'REQUIREMENT_GATHERED', 'PRICING_IN_PROGRESS', 'QUOTATION_SENT', 'NEGOTIATION', 'WON', 'LOST', 'ON_HOLD']),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const { ids, stage } = validation.data;

    // Fetch current stage of all inquiries to validate transitions
    const inquiries = await prisma.inquiry.findMany({
      where: { id: { in: ids } },
      select: { id: true, inquiryNumber: true, stage: true },
    });

    if (inquiries.length === 0) {
      throw new AppError('No inquiries found with the provided IDs', 404);
    }

    // Validate all transitions before updating any
    const invalidTransitions: string[] = [];
    const validIds: string[] = [];

    for (const inquiry of inquiries) {
      const allowed = INQUIRY_ALLOWED_TRANSITIONS[inquiry.stage] || [];
      if (inquiry.stage === stage) {
        // Already in target stage, skip but don't error
        continue;
      }
      if (!allowed.includes(stage)) {
        invalidTransitions.push(
          `${inquiry.inquiryNumber}: cannot change from ${inquiry.stage} to ${stage}`
        );
      } else {
        validIds.push(inquiry.id);
      }
    }

    if (invalidTransitions.length > 0 && validIds.length === 0) {
      throw new AppError(
        `No valid transitions. Invalid: ${invalidTransitions.join('; ')}`,
        400
      );
    }

    // Update only the inquiries with valid transitions
    const result = await prisma.inquiry.updateMany({
      where: { id: { in: validIds } },
      data: { stage },
    });

    logger.info('Bulk inquiry stage update', { 
      count: result.count, 
      stage, 
      userId: req.user!.id,
      skipped: invalidTransitions.length,
    });

    res.json({
      success: true,
      data: { 
        updated: result.count,
        ...(invalidTransitions.length > 0 && { 
          skipped: invalidTransitions.length,
          invalidTransitions,
        }),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Bulk deactivate products
router.put('/products/deactivate', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      ids: z.array(z.string()).min(1).max(100),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const { ids } = validation.data;

    const result = await prisma.product.updateMany({
      where: { id: { in: ids } },
      data: { isActive: false },
    });

    logger.info('Bulk product deactivation', { count: result.count, userId: req.user!.id });

    res.json({
      success: true,
      data: { deactivated: result.count },
    });
  } catch (error) {
    next(error);
  }
});

// Bulk complete tasks
router.put('/tasks/complete', authenticate, async (req, res, next) => {
  try {
    const schema = z.object({
      ids: z.array(z.string()).min(1).max(100),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const { ids } = validation.data;

    // Only allow completing own tasks unless admin
    const whereClause: any = { id: { in: ids }, status: { not: 'COMPLETED' } };
    if (!['FOUNDER', 'ADMIN'].includes(req.user!.role)) {
      whereClause.assigneeId = req.user!.id;
    }

    const result = await prisma.task.updateMany({
      where: whereClause,
      data: { 
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    logger.info('Bulk task completion', { count: result.count, userId: req.user!.id });

    res.json({
      success: true,
      data: { completed: result.count },
    });
  } catch (error) {
    next(error);
  }
});

export { router as bulkRouter };
