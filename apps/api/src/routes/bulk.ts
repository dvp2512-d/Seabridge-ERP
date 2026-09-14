/**
 * Bulk Operations Routes
 * 
 * Provides bulk update/delete operations for various modules.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError, AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router: Router = Router();

router.use(authenticate);

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

    const result = await prisma.exportOrder.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });

    logger.info('Bulk order status update', { count: result.count, status, userId: req.user!.id });

    res.json({
      success: true,
      data: { updated: result.count },
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

    const result = await prisma.invoice.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });

    logger.info('Bulk invoice status update', { count: result.count, status, userId: req.user!.id });

    res.json({
      success: true,
      data: { updated: result.count },
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

    const result = await prisma.inquiry.updateMany({
      where: { id: { in: ids } },
      data: { stage },
    });

    logger.info('Bulk inquiry stage update', { count: result.count, stage, userId: req.user!.id });

    res.json({
      success: true,
      data: { updated: result.count },
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
