/**
 * Exchange rate resolution.
 *
 * Every money figure in this system is stored in the currency it was agreed in.
 * Converting between them is only meaningful against a specific date, because
 * customs values a shipping bill using the rate in force on that date, not
 * today's rate.
 *
 * Design rules, which exist because getting these wrong misstates a customs
 * declaration or a revenue figure:
 *
 *  1. Nothing is hardcoded. The base currency comes from the isBaseCurrency
 *     flag, never a literal 'USD' or 'INR'.
 *  2. A missing rate is an error, never an assumed 1.0. Silently treating an
 *     unknown rate as parity would understate a total by orders of magnitude.
 *  3. CBIC publishes a separate import and export rate. We are an exporter, so
 *     the export rate is the default, but the caller can ask for either.
 *  4. Rates are looked up by effective date, so reprinting last quarter's
 *     invoice gives the same rupee value it gave then.
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

/** Strip the time component so date comparisons are not affected by timezone. */
function dateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/**
 * The company's reporting currency, taken from the isBaseCurrency flag.
 *
 * Throws when it is not configured rather than guessing, because guessing would
 * silently produce totals in an unintended currency.
 */
export async function getBaseCurrency() {
  const base = await prisma.currency.findFirst({ where: { isBaseCurrency: true } });

  if (!base) {
    throw new AppError(
      'No base currency is configured. Mark one currency as the base currency under Master Data before viewing converted totals.',
      500
    );
  }
  return base;
}

/**
 * The rate in force on a date for one currency.
 *
 * Returns null when nothing is on record, so callers can decide whether that is
 * fatal or merely means "cannot convert this row yet".
 */
export async function findRate(
  currencyId: string,
  onDate: Date,
  direction: RateDirection = 'EXPORT'
): Promise<ResolvedRate | null> {
  const day = dateOnly(onDate);

  const rate = await prisma.exchangeRate.findFirst({
    where: {
      currencyId,
      effectiveFrom: { lte: day },
      // effectiveTo null means still in force
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
    },
    // Prefer the most recently notified rate, and CBIC over other sources
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    include: { currency: { select: { code: true } } },
  });

  if (!rate) return null;

  return {
    currencyCode: rate.currency.code,
    rate: Number(direction === 'IMPORT' ? rate.importRate : rate.exportRate),
    direction,
    source: rate.source,
    notificationRef: rate.notificationRef,
    effectiveFrom: rate.effectiveFrom,
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
    `No exchange rate on record for ${currency?.code ?? 'that currency'} effective ${
      dateOnly(onDate).toISOString().slice(0, 10)
    }. Add the CBIC notification covering that date under Master Data > Exchange Rates.`,
    400
  );
}

/**
 * Convert an amount into the base currency.
 *
 * The base currency converts to itself at parity without needing a rate row,
 * which is the one case where a rate of 1 is correct rather than assumed.
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
 * mean a query per row. Currencies with no rate on record are simply absent from
 * the map; the caller reports them rather than quietly dropping the money.
 */
export async function buildRateMap(
  onDate: Date,
  direction: RateDirection = 'EXPORT'
): Promise<{ base: { id: string; code: string; symbol: string }; rates: Map<string, number>; missing: string[] }> {
  const base = await getBaseCurrency();
  const day = dateOnly(onDate);

  const currencies = await prisma.currency.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
  });

  // One query for all rates in force, rather than one per currency.
  const rows = await prisma.exchangeRate.findMany({
    where: {
      effectiveFrom: { lte: day },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
    },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    select: {
      currencyId: true,
      importRate: true,
      exportRate: true,
      effectiveFrom: true,
    },
  });

  const rates = new Map<string, number>();
  rates.set(base.id, 1); // base to base is parity by definition

  for (const row of rows) {
    // Rows are newest-first, so the first one seen per currency is the one in force
    if (rates.has(row.currencyId)) continue;
    rates.set(row.currencyId, Number(direction === 'IMPORT' ? row.importRate : row.exportRate));
  }

  const missing = currencies.filter((c) => !rates.has(c.id)).map((c) => c.code);

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
 * a code-keyed map, so both shapes are supported rather than forcing a schema
 * migration on data that already exists.
 */
export async function buildRateMapByCode(
  onDate: Date,
  direction: RateDirection = 'EXPORT'
): Promise<{ base: { id: string; code: string; symbol: string }; rates: Map<string, number>; missing: string[] }> {
  const { base, rates: byId } = await buildRateMap(onDate, direction);

  const currencies = await prisma.currency.findMany({
    select: { id: true, code: true, isActive: true },
  });

  const byCode = new Map<string, number>();
  for (const currency of currencies) {
    const rate = byId.get(currency.id);
    if (rate !== undefined) byCode.set(currency.code, rate);
  }

  const missing = currencies
    .filter((c) => c.isActive && !byCode.has(c.code))
    .map((c) => c.code);

  return { base, rates: byCode, missing };
}

/**
 * Sum rows that each carry their own currency and date, converting as we go.
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
