/**
 * Expenses.
 *
 * Costs incurred running the business - freight, CHA charges, packaging, travel.
 * Recorded in whatever currency they were paid in, so the summary converts into
 * the base currency rather than adding the raw numbers.
 *
 * Approval is a deliberate two-step: whoever records an expense is not
 * necessarily whoever approves it, and a paid expense cannot be edited.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';
import { getBaseCurrency } from '../services/exchangeRateService';
import { emitEvent } from '../services/eventService';
import {
  EXPENSE_SOURCE_TYPES,
  recalculateExpensePayment,
  syncProcurementExpense,
  syncShipmentExpenses,
} from '../services/expenseSyncService';

const router: Router = Router();

router.use(authenticate);

/**
 * Expense categories.
 *
 * The first four are also produced automatically from operational records - a
 * supplier purchase order, and the freight, CHA and transport costs on a shipment -
 * by services/expenseSyncService.ts. The rest are entered by hand.
 */
const CATEGORIES = [
  'SUPPLIER_PAYMENT',
  'FREIGHT',
  'CHA',
  'TRANSPORT',
  'PACKAGING',
  'INSPECTION',
  'CERTIFICATION',
  'TRAVEL',
  'OFFICE',
  'BANK_CHARGES',
  'OTHER',
] as const;

const STATUSES = ['PENDING', 'APPROVED', 'PAID', 'REJECTED'] as const;

// ---------------------------------------------------------------- list

router.get('/', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const {
      category,
      status,
      search,
      from,
      to,
      sourceType,
      // "generated" or "manual": which expenses came from an operational record.
      origin,
      page = 1,
      limit = 50,
    } = req.query;

    const where: any = {};
    if (category) where.category = String(category);
    if (status) where.status = String(status);
    if (sourceType && EXPENSE_SOURCE_TYPES.includes(String(sourceType) as any)) {
      where.sourceType = String(sourceType);
    }
    if (origin === 'generated') where.isGenerated = true;
    if (origin === 'manual') where.isGenerated = false;
    if (from || to) {
      where.expenseDate = {};
      if (from) where.expenseDate.gte = new Date(String(from));
      if (to) where.expenseDate.lte = new Date(String(to));
    }
    if (search) {
      where.OR = [
        { description: { contains: String(search), mode: 'insensitive' } },
        { vendorName: { contains: String(search), mode: 'insensitive' } },
        { expenseNumber: { contains: String(search), mode: 'insensitive' } },
        { invoiceRef: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [expenses, total, statusGroups, categoryGroups] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy: { expenseDate: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.expense.count({ where }),
      prisma.expense.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { amount: true, paidAmount: true, balanceAmount: true },
      }),
      prisma.expense.groupBy({
        by: ['category'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

    const countByStatus: Record<string, number> = {};
    let totalSpend = 0;
    let pendingApproval = 0;
    // What is still owed, across everything the filter matched. Distinct from
    // totalSpend, which is the whole cost whether paid or not.
    let outstanding = 0;
    let paid = 0;

    for (const group of statusGroups) {
      countByStatus[group.status] = group._count._all;
      const amount = Number(group._sum.amount ?? 0);
      // Rejected expenses are not spend.
      if (group.status !== 'REJECTED') {
        totalSpend += amount;
        outstanding += Number(group._sum.balanceAmount ?? 0);
        paid += Number(group._sum.paidAmount ?? 0);
      }
      if (group.status === 'PENDING') pendingApproval += amount;
    }

    const byCategory = new Map<string, number>();
    for (const group of categoryGroups) {
      byCategory.set(
        group.category,
        (byCategory.get(group.category) ?? 0) + Number(group._sum.amount ?? 0)
      );
    }

    res.json({
      success: true,
      data: expenses,
      pagination: { page: Number(page), limit: Number(limit), total },
      summary: {
        baseCurrency: await getBaseCurrency(),
        countByStatus,
        totalSpend: round2(totalSpend),
        pendingApproval: round2(pendingApproval),
        /** Still owed on everything matched. This is the payables figure. */
        outstanding: round2(outstanding),
        paid: round2(paid),
        byCategory: [...byCategory.entries()]
          .map(([category, value]) => ({ category, value: round2(value) }))
          .sort((a, b) => b.value - a.value),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      // The payment history is what the detail view is for, so it comes with it.
      include: { payments: { orderBy: { paymentDate: 'desc' } } },
    });
    if (!expense) throw new NotFoundError('Expense');
    res.json({ success: true, data: expense });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- create

const createSchema = z.object({
  category: z.enum(CATEGORIES),
  description: z.string().min(1, 'Description is required'),
  // INR. Expenses are domestic costs recorded in rupees, like every amount here.
  amount: z.number().positive('Amount must be greater than zero'),
  expenseDate: z.string().min(1),
  vendorName: z.string().optional(),
  invoiceRef: z.string().optional(),
  notes: z.string().optional(),
});

router.post('/', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const validation = createSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const data = validation.data;

    const expenseNumber = await generateCode('EXPENSE', 'EXP');

    const expense = await prisma.expense.create({
      data: {
        expenseNumber,
        category: data.category,
        description: data.description,
        amount: data.amount,
        expenseDate: new Date(data.expenseDate),
        vendorName: data.vendorName,
        invoiceRef: data.invoiceRef,
        notes: data.notes,
        // Nothing paid yet, so the whole amount is outstanding. Without this the
        // payables total would read zero for every newly recorded expense.
        paidAmount: 0,
        balanceAmount: data.amount,
      },
    });

    res.status(201).json({ success: true, data: expense });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- update

const updateSchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  description: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  expenseDate: z.string().optional(),
  vendorName: z.string().optional(),
  invoiceRef: z.string().optional(),
  notes: z.string().optional(),
});

router.put('/:id', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const validation = updateSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Expense');

    // Once money has gone out the record is evidence, not a draft.
    if (existing.status === 'PAID') {
      throw new AppError(
        'A paid expense cannot be edited. Record a correcting expense instead so the trail stays intact.',
        400
      );
    }

    /**
     * A generated expense mirrors an operational record, so its amount belongs to
     * that record. Editing it here would be overwritten the next time the shipment
     * or procurement is saved, which looks like the edit silently failing. The
     * source is the place to change it.
     *
     * Descriptive fields are still editable - a note explaining a charge is useful
     * and nothing regenerates it.
     */
    if (existing.isGenerated && validation.data.amount !== undefined) {
      const source =
        existing.sourceType === 'PROCUREMENT'
          ? 'the supplier purchase order'
          : 'the shipment';
      throw new AppError(
        `${existing.expenseNumber} was generated from ${source}, so its amount is maintained there. ` +
          `Change the cost on ${source} and this expense follows.`,
        400
      );
    }

    const { expenseDate, ...rest } = validation.data;

    const expense = await prisma.expense.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(expenseDate ? { expenseDate: new Date(expenseDate) } : {}),
        // The outstanding balance follows a changed amount, less anything paid.
        ...(rest.amount !== undefined
          ? {
              balanceAmount:
                Math.round((rest.amount - Number(existing.paidAmount) + Number.EPSILON) * 100) / 100,
            }
          : {}),
      },
    });

    res.json({ success: true, data: expense });
  } catch (error) {
    next(error);
  }
});

/**
 * Move an expense through PENDING -> APPROVED -> PAID, or reject it.
 *
 * Transitions are restricted so an expense cannot jump straight to paid without
 * being approved, and a rejected one cannot quietly become paid.
 */
const statusSchema = z.object({ status: z.enum(STATUSES) });

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['PAID', 'REJECTED'],
  REJECTED: ['PENDING'],
  PAID: [],
};

// PATCH for consistency with income status update and quotation status update
router.patch('/:id/status', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const validation = statusSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Expense');

    const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(validation.data.status)) {
      throw new AppError(
        `An expense that is ${existing.status} cannot become ${validation.data.status}.${
          allowed.length ? ` Allowed: ${allowed.join(', ')}.` : ' It is final.'
        }`,
        400
      );
    }

    /**
     * PAID is no longer a flag someone sets: it is what the payment records add up
     * to. Allowing it here would produce an expense marked paid with a full balance
     * still outstanding, which would then understate payables and contradict its own
     * payment history.
     */
    if (validation.data.status === 'PAID') {
      throw new AppError(
        `Record a payment against ${existing.expenseNumber} instead. It becomes PAID once ` +
          'the payments add up to the full amount, so the status always matches the money.',
        400
      );
    }

    const expense = await prisma.expense.update({
      where: { id: req.params.id },
      data: { status: validation.data.status },
    });

    // Only approval is announced: it is the point at which the cost becomes
    // committed and worth notifying on.
    if (validation.data.status === 'APPROVED') {
      emitEvent('expense.approved', expense);
    }

    res.json({ success: true, data: expense });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', can('RECORD_DELETE'), async (req, res, next) => {
  try {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Expense');

    // Deletion is founder-only, and nothing references an expense, so a paid one
    // can be removed without leaving orphaned records. The audit log retains who
    // deleted it and when.
    await prisma.expense.delete({ where: { id: req.params.id } });
    res.json({ success: true, data: { id: existing.id } });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- payments

/**
 * Payments made against an expense.
 *
 * The outgoing counterpart of invoice payments. Suppliers are routinely paid in
 * parts - an advance against the purchase order, the balance on delivery - so a
 * single paid flag could not represent what is actually still owed.
 *
 * The expense's paidAmount, balanceAmount and status are recalculated from the
 * payment rows rather than set here, so the three can never disagree with the
 * history. See recalculateExpensePayment.
 */
const paymentSchema = z.object({
  amount: z.number().positive('A payment must be greater than zero'),
  paymentDate: z.string(),
  method: z.enum(['BANK_TRANSFER', 'CHEQUE', 'CASH', 'UPI', 'CARD']).optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

router.get('/:id/payments', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      select: { id: true, amount: true, paidAmount: true, balanceAmount: true },
    });
    if (!expense) throw new NotFoundError('Expense');

    const payments = await prisma.expensePayment.findMany({
      where: { expenseId: req.params.id },
      orderBy: { paymentDate: 'desc' },
    });

    res.json({ success: true, data: { expense, payments } });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/payments', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const validation = paymentSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const data = validation.data;

    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        expenseNumber: true,
        amount: true,
        paidAmount: true,
        status: true,
      },
    });
    if (!expense) throw new NotFoundError('Expense');

    if (expense.status === 'REJECTED') {
      throw new AppError(
        `${expense.expenseNumber} was rejected. Reopen it before recording a payment.`,
        400
      );
    }

    const amount = Number(expense.amount);
    const alreadyPaid = Number(expense.paidAmount);
    const outstanding = Math.round((amount - alreadyPaid + Number.EPSILON) * 100) / 100;

    // Overpaying is refused rather than allowed to produce a negative balance,
    // which would understate payables elsewhere and is almost always a typo.
    if (data.amount > outstanding + 0.005) {
      throw new AppError(
        `That is more than is outstanding. ${expense.expenseNumber} has ` +
          `INR ${outstanding.toFixed(2)} left to pay of INR ${amount.toFixed(2)}.`,
        400
      );
    }

    // One transaction: the payment and the recalculated totals must not part company.
    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.expensePayment.create({
        data: {
          expenseId: expense.id,
          amount: data.amount,
          paymentDate: new Date(data.paymentDate),
          method: data.method ?? 'BANK_TRANSFER',
          reference: data.reference,
          notes: data.notes,
        },
      });

      await recalculateExpensePayment(expense.id, tx as any);
      return created;
    });

    const updated = await prisma.expense.findUnique({ where: { id: expense.id } });

    if (updated?.status === 'PAID') emitEvent('expense.paid', updated);

    res.status(201).json({ success: true, data: { payment, expense: updated } });
  } catch (error) {
    next(error);
  }
});

/**
 * Reverse a payment - a cheque bounced, or the entry was wrong.
 *
 * Deletes rather than negates, because an expense payment carries no downstream
 * record that a reversal row would need to match, and the audit log already holds
 * what was removed and by whom. The expense's totals and status are recalculated,
 * so a fully paid expense correctly returns to part paid.
 */
router.delete('/:id/payments/:paymentId', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const payment = await prisma.expensePayment.findUnique({
      where: { id: req.params.paymentId },
      select: { id: true, expenseId: true },
    });
    if (!payment) throw new NotFoundError('Payment');
    if (payment.expenseId !== req.params.id) {
      throw new NotFoundError('Payment not found for this expense');
    }

    await prisma.$transaction(async (tx) => {
      await tx.expensePayment.delete({ where: { id: payment.id } });
      await recalculateExpensePayment(payment.expenseId, tx as any);
    });

    const updated = await prisma.expense.findUnique({ where: { id: payment.expenseId } });
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

/**
 * Generate expenses for procurements and shipments that already exist.
 *
 * Records created before the sync existed have no expense behind them, so the
 * payables figure would only be right for new work. This walks the existing rows
 * once and raises what is missing.
 *
 * Safe to run repeatedly: every expense is keyed on its source record by a unique
 * index, so a second run updates rather than duplicates. Reported per record so a
 * partial result is visible rather than silent.
 *
 * Restricted to FINANCE_MANAGE because it writes to the ledger, even though it
 * writes nothing that saving each source record would not have written anyway.
 */
router.post('/sync', can('FINANCE_MANAGE'), async (_req, res, next) => {
  try {
    const [procurements, shipments] = await Promise.all([
      prisma.procurement.findMany({ select: { id: true } }),
      prisma.shipment.findMany({
        // Only shipments carrying at least one cost can produce an expense.
        where: {
          OR: [
            { freightCost: { not: null } },
            { chaCharges: { not: null } },
            { transportCharges: { not: null } },
          ],
        },
        select: { id: true },
      }),
    ]);

    const tally = { created: 0, updated: 0, deleted: 0, locked: 0, unchanged: 0 };
    const conflicts: string[] = [];

    const record = (result: { action: keyof typeof tally; conflict?: string }) => {
      tally[result.action] += 1;
      if (result.conflict) conflicts.push(result.conflict);
    };

    for (const procurement of procurements) {
      record(await syncProcurementExpense(procurement.id));
    }

    for (const shipment of shipments) {
      for (const result of await syncShipmentExpenses(shipment.id)) {
        record(result);
      }
    }

    res.json({
      success: true,
      data: {
        procurementsScanned: procurements.length,
        shipmentsScanned: shipments.length,
        ...tally,
        conflicts,
      },
    });
  } catch (error) {
    next(error);
  }
});

/** Category list for the UI, so the options cannot drift from the validation. */
router.get('/meta/options', can('FINANCE_VIEW'), async (_req, res) => {
  res.json({
    success: true,
    data: { categories: CATEGORIES, statuses: STATUSES },
  });
});

/**
 * Search vendors across Suppliers, CHAs, and Transporters for auto-complete.
 * Returns a unified list with the source type so the UI can display it.
 */
router.get('/meta/vendors', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const { search, category } = req.query;
    const searchFilter = search
      ? { name: { contains: String(search), mode: 'insensitive' as const } }
      : {};

    // Fetch based on category for smarter suggestions
    const results: { id: string; name: string; type: string; contactPerson?: string }[] = [];

    // For CHA category, prioritize CHA agents
    if (!category || category === 'CHA') {
      const chas = await prisma.cHA.findMany({
        where: { isActive: true, ...searchFilter },
        select: { id: true, name: true, contactPerson: true },
        take: 10,
      });
      results.push(...chas.map(c => ({ id: c.id, name: c.name, type: 'CHA', contactPerson: c.contactPerson || undefined })));
    }

    // For TRANSPORT category, prioritize Transporters
    if (!category || category === 'TRANSPORT' || category === 'FREIGHT') {
      const transporters = await prisma.transporter.findMany({
        where: { isActive: true, ...searchFilter },
        select: { id: true, name: true, contactPerson: true },
        take: 10,
      });
      results.push(...transporters.map(t => ({ id: t.id, name: t.name, type: 'TRANSPORTER', contactPerson: t.contactPerson || undefined })));
    }

    // For other categories or general search, include Suppliers
    if (!category || !['CHA', 'TRANSPORT'].includes(String(category))) {
      const suppliers = await prisma.supplier.findMany({
        where: { isActive: true, ...searchFilter },
        select: { id: true, name: true, contactPerson: true },
        take: 10,
      });
      results.push(...suppliers.map(s => ({ id: s.id, name: s.name, type: 'SUPPLIER', contactPerson: s.contactPerson || undefined })));
    }

    // Sort by name and limit
    results.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ success: true, data: results.slice(0, 20) });
  } catch (error) {
    next(error);
  }
});

/**
 * Get linkable records (shipments, orders) that can be associated with an expense.
 * Used to pre-fill expense details from existing business records.
 */
router.get('/meta/linkable-records', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const { category } = req.query;

    // For FREIGHT, CHA, TRANSPORT - fetch recent shipments with cost data
    const shipments = await prisma.shipment.findMany({
      where: {
        status: { notIn: ['DELIVERED'] },
      },
      select: {
        id: true,
        shipmentNumber: true,
        freightCost: true,
        status: true,
        cha: { select: { id: true, name: true } },
        transporter: { select: { id: true, name: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            buyer: { select: { companyName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Fetch recent orders for general expense linking
    const orders = await prisma.exportOrder.findMany({
      where: {
        status: { notIn: ['DELIVERED', 'CANCELLED'] },
      },
      select: {
        id: true,
        orderNumber: true,
        totalValue: true,
        status: true,
        buyer: { select: { companyName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Fetch recent procurements for supplier-related expenses
    const procurements = await prisma.procurement.findMany({
      where: {
        status: { notIn: ['RECEIVED'] },
      },
      select: {
        id: true,
        poNumber: true,
        totalAmount: true,
        status: true,
        supplier: { select: { id: true, name: true } },
        order: { select: { orderNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Build suggestions based on category
    const suggestions: any[] = [];

    if (category === 'FREIGHT') {
      shipments.forEach(s => {
        if (s.freightCost) {
          suggestions.push({
            type: 'SHIPMENT',
            id: s.id,
            reference: s.shipmentNumber,
            description: `Freight for ${s.order?.orderNumber} - ${s.order?.buyer?.companyName}`,
            amount: Number(s.freightCost),
            vendorName: s.transporter?.name,
            vendorId: s.transporter?.id,
            vendorType: 'TRANSPORTER',
          });
        }
      });
    } else if (category === 'CHA') {
      shipments.forEach(s => {
        if (s.cha) {
          suggestions.push({
            type: 'SHIPMENT',
            id: s.id,
            reference: s.shipmentNumber,
            description: `CHA charges for ${s.order?.orderNumber} - ${s.order?.buyer?.companyName}`,
            amount: null, // CHA rates would need to be looked up
            vendorName: s.cha.name,
            vendorId: s.cha.id,
            vendorType: 'CHA',
          });
        }
      });
    } else if (category === 'TRANSPORT') {
      shipments.forEach(s => {
        if (s.transporter) {
          suggestions.push({
            type: 'SHIPMENT',
            id: s.id,
            reference: s.shipmentNumber,
            description: `Transport for ${s.order?.orderNumber} - ${s.order?.buyer?.companyName}`,
            amount: null,
            vendorName: s.transporter.name,
            vendorId: s.transporter.id,
            vendorType: 'TRANSPORTER',
          });
        }
      });
    }

    // Always include orders and procurements as linkable
    orders.forEach(o => {
      suggestions.push({
        type: 'ORDER',
        id: o.id,
        reference: o.orderNumber,
        description: `Order for ${o.buyer?.companyName}`,
        amount: null,
        status: o.status,
      });
    });

    procurements.forEach(p => {
      if (p.poNumber) {
        suggestions.push({
          type: 'PROCUREMENT',
          id: p.id,
          reference: p.poNumber,
          description: `PO ${p.poNumber} - ${p.supplier?.name} (${p.order?.orderNumber})`,
          amount: Number(p.totalAmount),
          vendorName: p.supplier?.name,
          vendorId: p.supplier?.id,
          vendorType: 'SUPPLIER',
        });
      }
    });

    res.json({ success: true, data: { shipments, orders, procurements, suggestions } });
  } catch (error) {
    next(error);
  }
});

export { router as expenseRouter };
