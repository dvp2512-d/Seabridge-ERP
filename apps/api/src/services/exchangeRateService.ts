/**
 * Exchange rate resolution.
 *
 * Every money figure in this system is stored in the currency it was agreed in.
 * Converting between them is needed for reporting and totals in the company's
 * base currency.
 *
 * Design rules:
 *  1. The base currency is determined by convention (INR for Indian exporters).
 *  2. A missing rate throws an error rather than assuming 1.0.
 *  3. Rates are stored per currency and can be updated as CBIC notifications change.
 */
import { prisma } from '@seabridge/database';
import { AppError } from '../middleware/errorHandler';

/** Which side of the CBIC notification applies. */
export type RateDirection = 'EXPORT' | 'IMPORT';

export interface ResolvedRate {
  currencyCode: string;
  /** Units of base currency per one unit of the foreign currency */
  rate: number;
  direction: RateDirection;
  source: string;
  notificationRef: string | null;
  effectiveFrom: Date;
}

/**
 * The company's reporting currency.
 * 
 * Returns INR as the base currency for Indian exporters.
 * Falls back to the first active currency if INR doesn't exist.
 */
export async function getBaseCurrency() {
  // For Indian exporters, INR is always the base currency
  let base = await prisma.currency.findFirst({ where: { code: 'INR', isActive: true } });

  if (!base) {
    // Fall back to first active currency
    base = await prisma.currency.findFirst({ where: { isActive: true } });
  }

  if (!base) {
    throw new AppError(
      'No currencies are configured. Add at least one currency under Master Data.',
      500
    );
  }
  return base;
}

/**
 * The rate in force for a currency.
 *
 * Returns null when nothing is on record, so callers can decide whether that is
 * fatal or merely means "cannot convert this row yet".
 * 
 * Note: This simplified implementation uses the current rate stored on the Currency
 * model. For historical rates, a separate ExchangeRateHistory model would be needed.
 */
export async function findRate(
  currencyId: string,
  onDate: Date,
  direction: RateDirection = 'EXPORT'
): Promise<ResolvedRate | null> {
  const currency = await prisma.currency.findUnique({
    where: { id: currencyId },
    select: { id: true, code: true, exchangeRate: true, updatedAt: true },
  });

  if (!currency) return null;

  // Base currency (INR) has implicit rate of 1
  if (currency.code === 'INR') {
    return {
      currencyCode: currency.code,
      rate: 1,
      direction,
      source: 'base_currency',
      notificationRef: null,
      effectiveFrom: currency.updatedAt,
    };
  }

  const rate = Number(currency.exchangeRate);
  if (!rate || rate === 0) return null;

  return {
    currencyCode: currency.code,
    rate,
    direction,
    source: 'currency_master',
    notificationRef: null,
    effectiveFrom: currency.updatedAt,
  };
}

/**
 * Like findRate but fatal when absent. Use where a wrong number is worse than
 * an error message - invoices, customs documents, anything a buyer sees.
 */
export async function requireRate(
  currencyId: string,
  onDate: Date,
  direction: RateDirection = 'EXPORT'
): Promise<ResolvedRate> {
  const resolved = await findRate(currencyId, onDate, direction);
  if (resolved) return resolved;

  const currency = await prisma.currency.findUnique({
    where: { id: currencyId },
    select: { code: true },
  });

  throw new AppError(
    `No exchange rate on record for ${currency?.code ?? 'that currency'}. Update the exchange rate under Master Data > Currencies.`,
    400
  );
}

/**
 * Convert an amount into the base currency (INR).
 *
 * The base currency converts to itself at parity without needing a rate row.
 */
export async function toBaseCurrency(
  amount: number,
  currencyId: string,
  onDate: Date,
  direction: RateDirection = 'EXPORT'
): Promise<{ amount: number; rate: number; baseCode: string }> {
  const base = await getBaseCurrency();

  if (currencyId === base.id) {
    return { amount, rate: 1, baseCode: base.code };
  }

  const resolved = await requireRate(currencyId, onDate, direction);
  return {
    amount: Math.round((amount * resolved.rate + Number.EPSILON) * 100) / 100,
    rate: resolved.rate,
    baseCode: base.code,
  };
}

/**
 * Rates for many currencies at once, keyed by currency id.
 *
 * Aggregates convert hundreds of rows, so resolving each one individually would
 * mean a query per row. Currencies with no rate (exchangeRate = 0) are absent from
 * the map; the caller reports them rather than quietly dropping the money.
 */
export async function buildRateMap(
  onDate: Date,
  direction: RateDirection = 'EXPORT'
): Promise<{ base: { id: string; code: string; symbol: string }; rates: Map<string, number>; missing: string[] }> {
  const base = await getBaseCurrency();

  const currencies = await prisma.currency.findMany({
    where: { isActive: true },
    select: { id: true, code: true, symbol: true, exchangeRate: true },
  });

  const rates = new Map<string, number>();
  const missing: string[] = [];

  for (const currency of currencies) {
    // Base currency is always 1
    if (currency.code === 'INR' || currency.id === base.id) {
      rates.set(currency.id, 1);
      continue;
    }

    const rate = Number(currency.exchangeRate);
    if (rate && rate > 0) {
      rates.set(currency.id, rate);
    } else {
      missing.push(currency.code);
    }
  }

  return {
    base: { id: base.id, code: base.code, symbol: base.symbol },
    rates,
    missing,
  };
}

/**
 * Rates keyed by ISO code rather than id.
 *
 * Some models store currency as an FK (Quotation, Invoice) and others as a plain
 * string (Payment, ExportOrder, Expense). Converting the string-based ones needs
 * a code-keyed map, so both shapes are supported.
 */
export async function buildRateMapByCode(
  onDate: Date,
  direction: RateDirection = 'EXPORT'
): Promise<{ base: { id: string; code: string; symbol: string }; rates: Map<string, number>; missing: string[] }> {
  const base = await getBaseCurrency();

  const currencies = await prisma.currency.findMany({
    where: { isActive: true },
    select: { id: true, code: true, symbol: true, exchangeRate: true },
  });

  const rates = new Map<string, number>();
  const missing: string[] = [];

  for (const currency of currencies) {
    // Base currency is always 1
    if (currency.code === 'INR' || currency.id === base.id) {
      rates.set(currency.code, 1);
      continue;
    }

    const rate = Number(currency.exchangeRate);
    if (rate && rate > 0) {
      rates.set(currency.code, rate);
    } else {
      missing.push(currency.code);
    }
  }

  return {
    base: { id: base.id, code: base.code, symbol: base.symbol },
    rates,
    missing,
  };
}

/**
 * Sum rows that each carry their own currency, converting as we go.
 *
 * Rows whose currency has no rate are counted separately rather than added at
 * face value, so a total is never quietly wrong - the caller can surface
 * "3 records could not be converted" instead of showing a smaller number as if
 * it were complete.
 */
export function sumConverted(
  rows: { amount: number; currencyId: string }[],
  rates: Map<string, number>
): { total: number; convertedCount: number; unconvertedCount: number } {
  let total = 0;
  let convertedCount = 0;
  let unconvertedCount = 0;

  for (const row of rows) {
    const rate = rates.get(row.currencyId);
    if (rate === undefined) {
      unconvertedCount++;
      continue;
    }
    total += row.amount * rate;
    convertedCount++;
  }

  return {
    total: Math.round((total + Number.EPSILON) * 100) / 100,
    convertedCount,
    unconvertedCount,
  };
}
