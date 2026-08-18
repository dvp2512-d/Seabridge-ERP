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
import { buildRateMapByCode } from '../services/exchangeRateService';

const router: Router = Router();

router.use(authenticate);

const CATEGORIES = [
  'FREIGHT',
  'CHA',
  'PACKAGING',
  'TRANSPORT',
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
    const { category, status, search, from, to, page = 1, limit = 50 } = req.query;

    const where: any = {};
    if (category) where.category = String(category);
    if (status) where.status = String(status);
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
      // Grouped by currency too, so the totals can be converted rather than
      // adding rupees to dollars.
      prisma.expense.groupBy({
        by: ['status', 'currency'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.expense.groupBy({
        by: ['category', 'currency'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const { base, rates } = await buildRateMapByCode(new Date());
    const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

    const countByStatus: Record<string, number> = {};
    let totalSpend = 0;
    let pendingApproval = 0;
    let unconverted = 0;

    for (const group of statusGroups) {
      countByStatus[group.status] = (countByStatus[group.status] ?? 0) + group._count._all;
      const rate = rates.get(group.currency);
      if (rate === undefined) {
        unconverted += group._count._all;
        continue;
      }
      const converted = Number(group._sum.amount ?? 0) * rate;
      // Rejected expenses are not spend.
      if (group.status !== 'REJECTED') totalSpend += converted;
      if (group.status === 'PENDING') pendingApproval += converted;
    }

    const byCategory = new Map<string, number>();
    for (const group of categoryGroups) {
      const rate = rates.get(group.currency);
      if (rate === undefined) continue;
      byCategory.set(
        group.category,
        (byCategory.get(group.category) ?? 0) + Number(group._sum.amount ?? 0) * rate
      );
    }

    res.json({
      success: true,
      data: expenses,
      pagination: { page: Number(page), limit: Number(limit), total },
      summary: {
        baseCurrency: base,
        unconvertedRecords: unconverted,
        countByStatus,
        totalSpend: round2(totalSpend),
        pendingApproval: round2(pendingApproval),
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
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
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
  amount: z.number().positive('Amount must be greater than zero'),
  currency: z.string().min(3).max(3).optional(),
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

    // Default to the company's own currency rather than a hardcoded one, since
    // most expenses are domestic.
    let currencyCode = data.currency?.toUpperCase();
    if (!currencyCode) {
      const base = await prisma.currency.findFirst({ where: { isBaseCurrency: true } });
      currencyCode = base?.code;
      if (!currencyCode) {
        throw new AppError(
          'No base currency is configured, so the expense currency cannot be defaulted. Set one under Master Data or state the currency explicitly.',
          400
        );
      }
    }

    // An unknown currency would make the expense unconvertible and quietly
    // missing from every total.
    const known = await prisma.currency.findFirst({ where: { code: currencyCode } });
    if (!known) {
      throw new AppError(
        `Currency "${currencyCode}" is not configured in Master Data. Add it before recording expenses in it.`,
        400
      );
    }

    const expenseNumber = await generateCode('EXPENSE', 'EXP');

    const expense = await prisma.expense.create({
      data: {
        expenseNumber,
        category: data.category,
        description: data.description,
        amount: data.amount,
        currency: currencyCode,
        expenseDate: new Date(data.expenseDate),
        vendorName: data.vendorName,
        invoiceRef: data.invoiceRef,
        notes: data.notes,
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

    const { expenseDate, ...rest } = validation.data;

    const expense = await prisma.expense.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(expenseDate ? { expenseDate: new Date(expenseDate) } : {}),
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

router.put('/:id/status', can('FINANCE_MANAGE'), async (req, res, next) => {
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

    const expense = await prisma.expense.update({
      where: { id: req.params.id },
      data: { status: validation.data.status },
    });

    res.json({ success: true, data: expense });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Expense');

    if (existing.status === 'PAID') {
      throw new AppError('A paid expense cannot be deleted - it is part of the audit trail.', 400);
    }

    await prisma.expense.delete({ where: { id: req.params.id } });
    res.json({ success: true, data: { id: existing.id } });
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

export { router as expenseRouter };
