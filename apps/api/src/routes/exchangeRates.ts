/**
 * Exchange rates management.
 *
 * This simplified implementation stores a single exchange rate per currency
 * in the Currency model itself (exchangeRate field). For full CBIC notification
 * history tracking, a separate ExchangeRateHistory model would be needed.
 *
 * Exchange rates represent units of INR per one unit of the foreign currency.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';
import { buildRateMap, findRate, getBaseCurrency } from '../services/exchangeRateService';

const router: Router = Router();

router.use(authenticate);

// ---------------------------------------------------------------- list

/**
 * Current rates for all active currencies.
 */
router.get('/current', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const currencies = await prisma.currency.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });

    const base = await getBaseCurrency();

    const rows = currencies.map((currency) => {
      const isBase = currency.code === 'INR' || currency.id === base.id;
      return {
        currencyId: currency.id,
        code: currency.code,
        name: currency.name,
        symbol: currency.symbol,
        isBaseCurrency: isBase,
        rate: isBase ? 1 : Number(currency.exchangeRate),
        updatedAt: currency.updatedAt,
      };
    });

    res.json({
      success: true,
      data: {
        asOf: new Date(),
        baseCurrency: { code: base.code, symbol: base.symbol },
        rates: rows,
        missingCount: rows.filter((r) => !r.isBaseCurrency && (!r.rate || r.rate === 0)).length,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- update rate

const updateRateSchema = z.object({
  exchangeRate: z.number().positive('Exchange rate must be greater than zero'),
});

/**
 * Update the exchange rate for a currency.
 */
router.put('/:currencyId', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const validation = updateRateSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const currency = await prisma.currency.findUnique({
      where: { id: req.params.currencyId },
    });
    if (!currency) throw new NotFoundError('Currency');

    // Don't allow setting rate for base currency
    if (currency.code === 'INR') {
      throw new AppError('Cannot set exchange rate for the base currency (INR)', 400);
    }

    const updated = await prisma.currency.update({
      where: { id: req.params.currencyId },
      data: { exchangeRate: validation.data.exchangeRate },
    });

    res.json({
      success: true,
      data: {
        currencyId: updated.id,
        code: updated.code,
        name: updated.name,
        exchangeRate: Number(updated.exchangeRate),
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Bulk update rates (for entering CBIC notifications).
 */
const bulkUpdateSchema = z.object({
  notificationRef: z.string().optional(),
  rates: z
    .array(
      z.object({
        currencyId: z.string().min(1),
        exchangeRate: z.number().positive('Exchange rate must be greater than zero'),
      })
    )
    .min(1, 'At least one rate is required'),
});

router.post('/bulk-update', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const validation = bulkUpdateSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const { rates } = validation.data;

    // Check for base currency in the update
    const currencies = await prisma.currency.findMany({
      where: { id: { in: rates.map((r) => r.currencyId) } },
      select: { id: true, code: true },
    });

    const inrCurrency = currencies.find((c) => c.code === 'INR');
    if (inrCurrency && rates.some((r) => r.currencyId === inrCurrency.id)) {
      throw new AppError('Cannot set exchange rate for the base currency (INR)', 400);
    }

    // Update all rates in a transaction
    await prisma.$transaction(
      rates.map((rate) =>
        prisma.currency.update({
          where: { id: rate.currencyId },
          data: { exchangeRate: rate.exchangeRate },
        })
      )
    );

    res.json({
      success: true,
      data: {
        updatedCount: rates.length,
        notificationRef: validation.data.notificationRef,
      },
    });
  } catch (error) {
    next(error);
  }
});

/** Which currencies cannot currently be converted, for warning banners. */
router.get('/coverage', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const { base, missing } = await buildRateMap(new Date());
    res.json({
      success: true,
      data: { asOf: new Date(), baseCurrency: base, missing, complete: missing.length === 0 },
    });
  } catch (error) {
    next(error);
  }
});

export { router as exchangeRateRouter };
