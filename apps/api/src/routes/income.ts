/**
 * Other Income: receipts that do not arrive through an export invoice.
 *
 * Duty drawback, RoDTEP scrips, interest, forex gain, commission, scrap sales and
 * recovered sample charges. Kept separate from Invoice and Payment on purpose -
 * export revenue and incentive income answer different questions, and merging
 * them would flatter sales performance and break comparison between periods.
 *
 * THE REPORTING RULE, enforced here rather than left to convention:
 *
 *   Every total, card, breakdown and export sums amountINR only.
 *   originalAmount is never summed across rows, because rows may be in different
 *   currencies and adding them produces a meaningless number.
 *
 * amountINR is always recomputed on the server from originalAmount x exchangeRate.
 * A client-supplied amountINR is ignored, so the stored figure cannot disagree
 * with the two numbers it is derived from.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';
import { startOfFinancialYear, financialYearLabel } from '../utils/period';

const router: Router = Router();

router.use(authenticate);

const CATEGORIES = [
  'DUTY_DRAWBACK',
  'RODTEP_MEIS',
  'INTEREST',
  'FOREX_GAIN',
  'COMMISSION',
  'SCRAP_SALES',
  'SAMPLE_CHARGES',
  'OTHER',
] as const;

const STATUSES = ['PENDING', 'RECEIVED'] as const;

/** Two decimals, for money. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The single place amountINR is derived. Every write path goes through this so a
 * new endpoint cannot accidentally store an unconverted figure.
 */
function toINR(originalAmount: number, exchangeRate: number): number {
  return round2(originalAmount * exchangeRate);
}

/**
 * Reject a currency that is not in the Currency master.
 *
 * Validated against the table rather than a hardcoded list, because currencies
 * are already maintained as master data and a fixed list would drift from it.
 */
async function assertKnownCurrency(code: string): Promise<void> {
  const currency = await prisma.currency.findFirst({ where: { code } });
  if (!currency) {
    throw new AppError(
      `Currency "${code}" is not configured in Master Data. Add it before recording income in it.`,
      400
    );
  }
}

/** The base currency needs no conversion, and claiming otherwise is an error. */
async function assertRateConsistent(code: string, rate: number): Promise<void> {
  // INR is the base currency for Indian exporters
  if (code === 'INR' && Math.abs(rate - 1) > 0.00005) {
    throw new AppError(
      `${code} is the base currency, so its exchange rate must be 1.0000.`,
      400
    );
  }
}

// ---------------------------------------------------------------- list

router.get('/', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const { category, status, search, from, to, page = 1, limit = 50 } = req.query;

    const where: any = {};
    if (category) where.category = String(category);
    if (status) where.status = String(status);
    if (from || to) {
      where.receivedDate = {};
      if (from) where.receivedDate.gte = new Date(String(from));
      if (to) where.receivedDate.lte = new Date(String(to));
    }
    if (search) {
      where.OR = [
        { description: { contains: String(search), mode: 'insensitive' } },
        { reference: { contains: String(search), mode: 'insensitive' } },
        { incomeNumber: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [entries, total, statusGroups, categoryGroups] = await Promise.all([
      prisma.income.findMany({
        where,
        orderBy: { receivedDate: 'desc' },
        skip,
        take: Number(limit),
        include: {
          linkedInvoice: { select: { id: true, invoiceNumber: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.income.count({ where }),
      // Summing amountINR, never originalAmount. Because every row is already in
      // rupees, no currency grouping or rate lookup is needed here at all - which
      // is the whole point of storing the converted figure.
      prisma.income.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { amountINR: true },
      }),
      prisma.income.groupBy({
        by: ['category'],
        where,
        _count: { _all: true },
        _sum: { amountINR: true },
      }),
    ]);

    const countByStatus: Record<string, number> = {};
    let totalReceived = 0;
    let totalPending = 0;

    for (const group of statusGroups) {
      countByStatus[group.status] = group._count._all;
      const amount = Number(group._sum.amountINR ?? 0);
      if (group.status === 'RECEIVED') totalReceived += amount;
      if (group.status === 'PENDING') totalPending += amount;
    }

    /**
     * The same figure the dashboard card shows: received, current financial year.
     *
     * Computed here regardless of the user's filters so the page can display it
     * alongside its own totals. Without this the two screens could only be
     * reconciled by manually setting a date filter, which is why they appeared to
     * disagree.
     */
    const fyAggregate = await prisma.income.aggregate({
      where: { status: 'RECEIVED', receivedDate: { gte: startOfFinancialYear() } },
      _sum: { amountINR: true },
    });
    const fyReceived = Number(fyAggregate._sum.amountINR ?? 0);

    res.json({
      success: true,
      data: entries,
      pagination: { page: Number(page), limit: Number(limit), total },
      summary: {
        // Stated explicitly so no screen has to assume it.
        currency: 'INR',
        /**
         * Which period these totals cover.
         *
         * Unfiltered, this list is all-time, while the dashboard card shows the
         * current financial year. Both are correct for what they measure, but the
         * two disagreeing without explanation is confusing, so the period is
         * reported and the screen states it.
         */
        period: {
          from: from ? new Date(String(from)) : null,
          to: to ? new Date(String(to)) : null,
          label: from || to ? 'Filtered period' : 'All time',
        },
        /** Current financial year figures, so the dashboard card is reproducible here. */
        financialYear: {
          label: financialYearLabel(),
          received: round2(fyReceived),
        },
        totalReceived: round2(totalReceived),
        totalPending: round2(totalPending),
        totalAll: round2(totalReceived + totalPending),
        countByStatus,
        byCategory: categoryGroups
          .map((g) => ({
            category: g.category,
            count: g._count._all,
            amountINR: round2(Number(g._sum.amountINR ?? 0)),
          }))
          .sort((a, b) => b.amountINR - a.amountINR),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const entry = await prisma.income.findUnique({
      where: { id: req.params.id },
      include: {
        linkedInvoice: { select: { id: true, invoiceNumber: true, currency: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!entry) throw new NotFoundError('Income entry');
    res.json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
});

/**
 * Suggest a forex gain from an invoice's booked and realised rates.
 *
 *   gain = (realised rate - booked rate) x invoice amount in foreign currency
 *
 * Advisory: it returns the figures and the arithmetic, and the user still decides
 * what to record. The result is expressed in rupees, so it is entered as an INR
 * receipt with a rate of 1 rather than being converted a second time.
 */
router.get('/forex-gain/:invoiceId', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.invoiceId },
      include: {
        currency: { select: { code: true } },
        payments: { select: { id: true, amount: true, exchangeRate: true, paymentDate: true } },
      },
    });
    if (!invoice) throw new NotFoundError('Invoice');

    const bookedRate = Number(invoice.exchangeRate ?? 0);
    if (!bookedRate) {
      throw new AppError(
        `Invoice ${invoice.invoiceNumber} has no exchange rate recorded, so a forex gain cannot be derived from it.`,
        400
      );
    }

    if (invoice.payments.length === 0) {
      throw new AppError(
        `Invoice ${invoice.invoiceNumber} has no payments yet, so nothing has been realised.`,
        400
      );
    }

    // One line per payment: the gain is realised as each receipt lands, not once
    // for the invoice as a whole.
    const breakdown = invoice.payments.map((p) => {
      const realisedRate = Number(p.exchangeRate ?? 0);
      const amount = Number(p.amount);
      return {
        paymentId: p.id,
        paymentDate: p.paymentDate,
        amount,
        bookedRate,
        realisedRate,
        gainINR: round2((realisedRate - bookedRate) * amount),
      };
    });

    const totalGain = round2(breakdown.reduce((s, b) => s + b.gainINR, 0));

    res.json({
      success: true,
      data: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceCurrency: invoice.currency?.code,
        bookedRate,
        breakdown,
        // Negative means a loss; surfaced rather than hidden, since booking only
        // the gains would overstate income.
        totalGainINR: totalGain,
        isLoss: totalGain < 0,
        formula: '(realised rate - booked rate) x payment amount',
      },
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- create

const createSchema = z.object({
  category: z.enum(CATEGORIES),
  description: z.string().min(1, 'Description is required'),
  originalAmount: z.number().positive('Amount must be greater than zero'),
  originalCurrency: z.string().min(3).max(3).optional(),
  exchangeRate: z.number().positive('Exchange rate must be greater than zero').optional(),
  receivedDate: z.string().min(1),
  reference: z.string().optional(),
  linkedInvoiceId: z.string().optional(),
  status: z.enum(STATUSES).optional(),
  notes: z.string().optional(),
});

router.post('/', can('FINANCE_MANAGE'), async (req: any, res, next) => {
  try {
    const validation = createSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const data = validation.data;
    const currency = (data.originalCurrency ?? 'INR').toUpperCase();
    const rate = data.exchangeRate ?? 1;

    await assertKnownCurrency(currency);
    await assertRateConsistent(currency, rate);

    // A forex gain that cannot be traced to its invoice reconciles against
    // nothing, so the link is required rather than optional for that category.
    if (data.category === 'FOREX_GAIN' && !data.linkedInvoiceId) {
      throw new AppError(
        'A forex gain must be linked to the invoice it arose from, so the figure stays traceable.',
        400
      );
    }

    if (data.linkedInvoiceId) {
      const invoice = await prisma.invoice.findUnique({
        where: { id: data.linkedInvoiceId },
        select: { id: true },
      });
      if (!invoice) throw new AppError('The linked invoice does not exist', 400);
    }

    const incomeNumber = await generateCode('INCOME', 'INC');

    const entry = await prisma.income.create({
      data: {
        incomeNumber,
        category: data.category,
        description: data.description,
        originalAmount: data.originalAmount,
        originalCurrency: currency,
        exchangeRate: rate,
        // Derived here, never accepted from the client.
        amountINR: toINR(data.originalAmount, rate),
        receivedDate: new Date(data.receivedDate),
        reference: data.reference,
        linkedInvoiceId: data.linkedInvoiceId,
        status: data.status ?? 'PENDING',
        notes: data.notes,
        createdById: req.user.id,
      },
      include: {
        linkedInvoice: { select: { id: true, invoiceNumber: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- update

const updateSchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  description: z.string().min(1).optional(),
  originalAmount: z.number().positive().optional(),
  originalCurrency: z.string().min(3).max(3).optional(),
  exchangeRate: z.number().positive().optional(),
  receivedDate: z.string().optional(),
  reference: z.string().optional(),
  status: z.enum(STATUSES).optional(),
  notes: z.string().optional(),
});

router.put('/:id', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const validation = updateSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.income.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Income entry');

    const data = validation.data;

    // Recompute from whichever of the two inputs changed, so the stored rupee
    // figure can never drift from the amount and rate shown beside it.
    const originalAmount = data.originalAmount ?? Number(existing.originalAmount);
    const currency = (data.originalCurrency ?? existing.originalCurrency).toUpperCase();
    const rate = data.exchangeRate ?? Number(existing.exchangeRate);

    if (data.originalCurrency) await assertKnownCurrency(currency);
    await assertRateConsistent(currency, rate);

    const { receivedDate, ...rest } = data;

    const entry = await prisma.income.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        originalCurrency: currency,
        exchangeRate: rate,
        originalAmount,
        amountINR: toINR(originalAmount, rate),
        ...(receivedDate ? { receivedDate: new Date(receivedDate) } : {}),
      },
      include: {
        linkedInvoice: { select: { id: true, invoiceNumber: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    res.json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
});

/** RECEIVED / PENDING toggle. */
router.patch('/:id/status', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({ status: z.enum(STATUSES) });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.income.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Income entry');

    const entry = await prisma.income.update({
      where: { id: req.params.id },
      data: { status: validation.data.status },
    });

    res.json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
});

/** Founder only, matching every other business record. */
router.delete('/:id', can('RECORD_DELETE'), async (req, res, next) => {
  try {
    const existing = await prisma.income.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Income entry');

    await prisma.income.delete({ where: { id: req.params.id } });
    res.json({ success: true, data: { id: existing.id }, message: `${existing.incomeNumber} deleted.` });
  } catch (error) {
    next(error);
  }
});

/** Options for the UI, so the form cannot drift from the validation. */
router.get('/meta/options', can('FINANCE_VIEW'), async (_req, res, next) => {
  try {
    const currencies = await prisma.currency.findMany({
      where: { isActive: true },
      select: { code: true, name: true },
      orderBy: { code: 'asc' },
    });
    // Add isBaseCurrency flag for UI (INR is base for Indian exporters)
    const currenciesWithBase = currencies.map(c => ({
      ...c,
      isBaseCurrency: c.code === 'INR'
    }));
    res.json({ success: true, data: { categories: CATEGORIES, statuses: STATUSES, currencies: currenciesWithBase } });
  } catch (error) {
    next(error);
  }
});

export { router as incomeRouter };
