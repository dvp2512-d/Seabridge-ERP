/**
 * Notified exchange rates.
 *
 * CBIC notifies rates for 22 currencies twice a month (1st and 3rd Thursday),
 * effective from midnight of the following day, with a separate rate for
 * imports and exports. There is no reliable machine-readable feed - the
 * community API is dead and CBIC publishes notification PDFs - so rates are
 * entered from the notification, which is 24 entries a year.
 *
 * Entering a notification closes off the previous period automatically, so the
 * history stays contiguous and a lookup by date can only match one row.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';
import { buildRateMap, findRate, getBaseCurrency } from '../services/exchangeRateService';

const router: Router = Router();

router.use(authenticate);

/** Midnight UTC, so a date is not shifted by the server's timezone. */
function parseDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(`'${value}' is not a valid date`, 400);
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ---------------------------------------------------------------- list

/**
 * Rates in force on a date, one row per currency, with how old each one is.
 * Defaults to today so the screen opens on the current position.
 */
router.get('/current', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const onDate = req.query.date ? parseDate(String(req.query.date)) : new Date();
    const direction = String(req.query.direction ?? 'EXPORT').toUpperCase() as 'EXPORT' | 'IMPORT';

    const currencies = await prisma.currency.findMany({
      where: { isActive: true },
      orderBy: [{ isBaseCurrency: 'desc' }, { code: 'asc' }],
    });

    const base = await getBaseCurrency();

    const rows = await Promise.all(
      currencies.map(async (currency) => {
        // The base currency has no rate against itself.
        if (currency.id === base.id) {
          return {
            currencyId: currency.id,
            code: currency.code,
            name: currency.name,
            symbol: currency.symbol,
            isBaseCurrency: true,
            rate: 1,
            source: null,
            notificationRef: null,
            effectiveFrom: null,
            ageInDays: null,
          };
        }

        const resolved = await findRate(currency.id, onDate, direction);
        return {
          currencyId: currency.id,
          code: currency.code,
          name: currency.name,
          symbol: currency.symbol,
          isBaseCurrency: false,
          rate: resolved?.rate ?? null,
          source: resolved?.source ?? null,
          notificationRef: resolved?.notificationRef ?? null,
          effectiveFrom: resolved?.effectiveFrom ?? null,
          ageInDays: resolved
            ? Math.floor((onDate.getTime() - resolved.effectiveFrom.getTime()) / 86400000)
            : null,
        };
      })
    );

    res.json({
      success: true,
      data: {
        asOf: onDate,
        direction,
        baseCurrency: { code: base.code, symbol: base.symbol },
        rates: rows,
        missingCount: rows.filter((r) => !r.isBaseCurrency && r.rate === null).length,
      },
    });
  } catch (error) {
    next(error);
  }
});

/** Full history for one currency, newest first. */
router.get('/history/:currencyId', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const history = await prisma.exchangeRate.findMany({
      where: { currencyId: req.params.currencyId },
      orderBy: { effectiveFrom: 'desc' },
      include: { currency: { select: { code: true, name: true } } },
      take: 100,
    });

    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- create

const notificationSchema = z.object({
  /** e.g. "Notification No. 55/2026-Customs (N.T.)" */
  notificationRef: z.string().min(1, 'Notification reference is required'),
  effectiveFrom: z.string().min(1, 'Effective date is required'),
  source: z.enum(['CBIC', 'RBI', 'MARKET', 'MANUAL']).default('CBIC'),
  notes: z.string().optional(),
  rates: z
    .array(
      z.object({
        currencyId: z.string().min(1),
        importRate: z.number().positive('Import rate must be greater than zero'),
        exportRate: z.number().positive('Export rate must be greater than zero'),
      })
    )
    .min(1, 'At least one rate is required'),
});

/**
 * Record a notification: one effective date, many currency rates.
 *
 * Runs in a transaction so a partial entry cannot leave the history with some
 * currencies updated and others not, which would make totals inconsistent
 * depending on which currency a document happened to use.
 */
router.post('/notification', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const validation = notificationSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const { notificationRef, source, notes, rates } = validation.data;
    const effectiveFrom = parseDate(validation.data.effectiveFrom);

    const base = await getBaseCurrency();

    // The base currency has no rate against itself; accepting one would create
    // two competing definitions of parity.
    const baseIncluded = rates.find((r) => r.currencyId === base.id);
    if (baseIncluded) {
      throw new AppError(
        `${base.code} is the base currency and cannot have a rate against itself.`,
        400
      );
    }

    // An export rate above the import rate is the wrong way round; CBIC always
    // notifies the import rate higher. Catching it here prevents a typo from
    // undervaluing every shipping bill in the period.
    const inverted = rates.filter((r) => r.exportRate > r.importRate);
    if (inverted.length > 0) {
      const codes = await prisma.currency.findMany({
        where: { id: { in: inverted.map((r) => r.currencyId) } },
        select: { code: true },
      });
      throw new AppError(
        `Export rate is higher than the import rate for ${codes
          .map((c) => c.code)
          .join(', ')}. CBIC notifies the import rate higher; check the columns are not swapped.`,
        400
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const created: string[] = [];

      for (const entry of rates) {
        // Close off whatever was in force for this currency, so lookups by date
        // match exactly one row.
        await tx.exchangeRate.updateMany({
          where: {
            currencyId: entry.currencyId,
            source,
            effectiveTo: null,
            effectiveFrom: { lt: effectiveFrom },
          },
          data: { effectiveTo: new Date(effectiveFrom.getTime() - 86400000) },
        });

        // Re-entering the same notification should correct it, not fail.
        await tx.exchangeRate.upsert({
          where: {
            currencyId_source_effectiveFrom: {
              currencyId: entry.currencyId,
              source,
              effectiveFrom,
            },
          },
          update: {
            importRate: entry.importRate,
            exportRate: entry.exportRate,
            notificationRef,
            notes,
          },
          create: {
            currencyId: entry.currencyId,
            importRate: entry.importRate,
            exportRate: entry.exportRate,
            effectiveFrom,
            source,
            notificationRef,
            notes,
          },
        });
        created.push(entry.currencyId);
      }

      return created;
    });

    res.status(201).json({
      success: true,
      data: { notificationRef, effectiveFrom, source, currencyCount: result.length },
    });
  } catch (error) {
    next(error);
  }
});

/** Correct a single rate row. */
const updateSchema = z.object({
  importRate: z.number().positive().optional(),
  exportRate: z.number().positive().optional(),
  notificationRef: z.string().optional(),
  notes: z.string().optional(),
});

router.put('/:id', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const validation = updateSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.exchangeRate.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Exchange rate');

    const importRate = validation.data.importRate ?? Number(existing.importRate);
    const exportRate = validation.data.exportRate ?? Number(existing.exportRate);
    if (exportRate > importRate) {
      throw new AppError('Export rate cannot be higher than the import rate', 400);
    }

    const updated = await prisma.exchangeRate.update({
      where: { id: req.params.id },
      data: validation.data,
      include: { currency: { select: { code: true } } },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const existing = await prisma.exchangeRate.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Exchange rate');

    await prisma.exchangeRate.delete({ where: { id: req.params.id } });

    // Reopen the preceding period so the history does not develop a hole that
    // would make documents in that window unconvertible.
    const previous = await prisma.exchangeRate.findFirst({
      where: {
        currencyId: existing.currencyId,
        source: existing.source,
        effectiveFrom: { lt: existing.effectiveFrom },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (previous) {
      await prisma.exchangeRate.update({
        where: { id: previous.id },
        data: { effectiveTo: existing.effectiveTo },
      });
    }

    res.json({ success: true, data: { id: existing.id } });
  } catch (error) {
    next(error);
  }
});

/**
 * Market rates for cross-checking a typed notification.
 *
 * CBIC rates track the market within a few percent, so a figure that is wildly
 * different usually means a transposed digit. Purely advisory - the notified
 * rate is what gets used.
 */
router.get('/market-check', can('MASTER_VIEW'), async (_req, res, next) => {
  try {
    const base = await getBaseCurrency();

    // No API key needed, and a failure here must not block rate entry.
    const response = await fetch(`https://open.er-api.com/v6/latest/${base.code}`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return res.json({
        success: true,
        data: { available: false, reason: `provider returned ${response.status}` },
      });
    }

    const payload: any = await response.json();
    const perBase: Record<string, number> = payload?.rates ?? {};

    // The provider gives foreign-per-base; documents need base-per-foreign.
    const inverted: Record<string, number> = {};
    for (const [code, value] of Object.entries(perBase)) {
      if (typeof value === 'number' && value > 0) {
        inverted[code] = Math.round((1 / value) * 10000) / 10000;
      }
    }

    res.json({
      success: true,
      data: {
        available: true,
        baseCode: base.code,
        asOf: payload?.time_last_update_utc ?? null,
        ratesPerForeignUnit: inverted,
      },
    });
  } catch (error) {
    // Advisory only, so a provider outage returns "unavailable" rather than 500.
    res.json({
      success: true,
      data: { available: false, reason: (error as Error).message },
    });
  }
});

/** Which currencies cannot currently be converted, for warning banners. */
router.get('/coverage', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const onDate = req.query.date ? parseDate(String(req.query.date)) : new Date();
    const { base, missing } = await buildRateMap(onDate);
    res.json({
      success: true,
      data: { asOf: onDate, baseCurrency: base, missing, complete: missing.length === 0 },
    });
  } catch (error) {
    next(error);
  }
});

export { router as exchangeRateRouter };
