import { Router } from 'express';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { NotFoundError, AppError } from '../middleware/errorHandler';

const router: Router = Router();

router.use(authenticate);

/**
 * Resource type configuration for deletion.
 * Maps URL segments to Prisma models and their cascade relationships.
 */
const DELETABLE_RESOURCES: Record<string, {
  model: string;
  label: string;
  cascades: { model: string; foreignKey: string; label: string }[];
}> = {
  quotation: {
    model: 'quotation',
    label: 'Quotation',
    cascades: [
      { model: 'quotationItem', foreignKey: 'quotationId', label: 'line items' },
      { model: 'quotationCost', foreignKey: 'quotationId', label: 'additional costs' },
    ],
  },
  order: {
    model: 'exportOrder',
    label: 'Order',
    cascades: [
      { model: 'orderItem', foreignKey: 'orderId', label: 'line items' },
      { model: 'procurement', foreignKey: 'orderId', label: 'procurements' },
      { model: 'shipment', foreignKey: 'orderId', label: 'shipments' },
      { model: 'document', foreignKey: 'orderId', label: 'documents' },
      { model: 'invoice', foreignKey: 'orderId', label: 'invoices' },
    ],
  },
  invoice: {
    model: 'invoice',
    label: 'Invoice',
    cascades: [
      { model: 'payment', foreignKey: 'invoiceId', label: 'payments' },
    ],
  },
  inquiry: {
    model: 'inquiry',
    label: 'Inquiry',
    cascades: [
      { model: 'inquiryItem', foreignKey: 'inquiryId', label: 'line items' },
      { model: 'followUp', foreignKey: 'inquiryId', label: 'follow-ups' },
    ],
  },
  expense: {
    model: 'expense',
    label: 'Expense',
    cascades: [],
  },
  income: {
    model: 'income',
    label: 'Income',
    cascades: [],
  },
  task: {
    model: 'task',
    label: 'Task',
    cascades: [],
  },
};

/**
 * Preview what will be deleted.
 * Shows the record and all related records that will be cascade-deleted.
 */
router.get('/:resource/:id/preview', can('RECORD_DELETE'), async (req, res, next) => {
  try {
    const { resource, id } = req.params;
    
    const config = DELETABLE_RESOURCES[resource];
    if (!config) {
      throw new AppError(`Resource type '${resource}' is not deletable`, 400);
    }

    // Get the main record
    const delegate = (prisma as any)[config.model];
    const record = await delegate.findUnique({
      where: { id },
    });

    if (!record) {
      throw new NotFoundError(`${config.label} not found`);
    }

    // Count related records that will be deleted
    const cascadeCounts: { label: string; count: number }[] = [];
    
    for (const cascade of config.cascades) {
      const cascadeDelegate = (prisma as any)[cascade.model];
      const count = await cascadeDelegate.count({
        where: { [cascade.foreignKey]: id },
      });
      if (count > 0) {
        cascadeCounts.push({ label: cascade.label, count });
      }
    }

    // For orders, also count payments on invoices
    if (resource === 'order') {
      const invoices = await prisma.invoice.findMany({
        where: { orderId: id },
        select: { id: true },
      });
      if (invoices.length > 0) {
        const paymentCount = await prisma.payment.count({
          where: { invoiceId: { in: invoices.map(i => i.id) } },
        });
        if (paymentCount > 0) {
          cascadeCounts.push({ label: 'payments (on invoices)', count: paymentCount });
        }
      }
    }

    res.json({
      success: true,
      data: {
        resource: config.label,
        record: {
          id: record.id,
          identifier: record.quotationNumber || record.orderNumber || record.invoiceNumber || record.name || record.id,
          createdAt: record.createdAt,
        },
        cascadeDeletes: cascadeCounts,
        warning: cascadeCounts.length > 0 
          ? `This will permanently delete ${cascadeCounts.map(c => `${c.count} ${c.label}`).join(', ')}`
          : 'No related records will be affected',
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Permanently delete a record and all related data.
 * FOUNDER ONLY - this action cannot be undone.
 */
router.delete('/:resource/:id', can('RECORD_DELETE'), async (req, res, next) => {
  try {
    const { resource, id } = req.params;
    const { confirmDelete } = req.body;

    if (confirmDelete !== 'DELETE') {
      throw new AppError('Deletion must be confirmed by sending confirmDelete: "DELETE"', 400);
    }
    
    const config = DELETABLE_RESOURCES[resource];
    if (!config) {
      throw new AppError(`Resource type '${resource}' is not deletable`, 400);
    }

    // Verify record exists
    const delegate = (prisma as any)[config.model];
    const record = await delegate.findUnique({
      where: { id },
    });

    if (!record) {
      throw new NotFoundError(`${config.label} not found`);
    }

    // Delete in transaction with cascade
    await prisma.$transaction(async (tx) => {
      // For orders, delete payments on invoices first
      if (resource === 'order') {
        const invoices = await tx.invoice.findMany({
          where: { orderId: id },
          select: { id: true },
        });
        if (invoices.length > 0) {
          await tx.payment.deleteMany({
            where: { invoiceId: { in: invoices.map(i => i.id) } },
          });
        }
      }

      // Delete cascade records in reverse dependency order
      for (const cascade of [...config.cascades].reverse()) {
        const cascadeDelegate = (tx as any)[cascade.model];
        await cascadeDelegate.deleteMany({
          where: { [cascade.foreignKey]: id },
        });
      }

      // Delete the main record
      const mainDelegate = (tx as any)[config.model];
      await mainDelegate.delete({
        where: { id },
      });

      // Log the deletion in audit
      await tx.auditLog.create({
        data: {
          userId: (req as any).user.id,
          action: 'PERMANENT_DELETE',
          entityType: config.model.toUpperCase(),
          entityId: id,
          oldValues: record,
          newValues: null,
          ipAddress: req.ip || null,
        },
      });
    });

    res.json({
      success: true,
      message: `${config.label} permanently deleted`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * List deletable resource types for UI dropdown.
 */
router.get('/types', can('RECORD_DELETE'), async (_req, res, next) => {
  try {
    const types = Object.entries(DELETABLE_RESOURCES).map(([key, value]) => ({
      value: key,
      label: value.label,
    }));

    res.json({
      success: true,
      data: types,
    });
  } catch (error) {
    next(error);
  }
});

export { router as recordDeletionRouter };
