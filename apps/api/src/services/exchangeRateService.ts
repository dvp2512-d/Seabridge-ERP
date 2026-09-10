/**
 * Currency helpers.
 *
 * Every monetary column in this system is stored in INR, so there is no
 * conversion to do when reading. That is the whole point: totals are plain sums,
 * and no later edit can change a figure that has already been reported.
 *
 * A currency and an exchange rate are chosen at the moment a quotation or invoice
 * PDF is generated, applied to that document only, and recorded on it
 * (Quotation.pdfCurrency / pdfExchangeRate). See `toDocumentCurrency` below for
 * the arithmetic, and services/pdfService.ts for how a document is rendered.
 *
 * This module previously resolved a rate per currency from a single mutable column
 * on `currencies` and converted at read time. Editing that column silently
 * re-priced history - the same USD 5,000 payment reported as 415,600 at 83.12 and
 * 478,250 at 95.65 - which is why it was removed.
 */
import { prisma } from '@seabridge/database';
import { AppError } from '../middleware/errorHandler';

/** ISO code of the currency every stored amount is denominated in. */
export const BASE_CURRENCY_CODE = 'INR';

/**
 * The company's reporting currency, and the currency of every stored amount.
 *
 * Falls back to the first active currency if INR is not configured, so a
 * mis-seeded database degrades to a wrong label rather than a crash.
 */
export async function getBaseCurrency() {
  let base = await prisma.currency.findFirst({
    where: { code: BASE_CURRENCY_CODE, isActive: true },
  });

  if (!base) {
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
 * Resolve the currency a document is to be printed in.
 *
 * Throws when the code is not in the Currency master, so a typo cannot reach a
 * buyer's document, and validates the rate. A rate of 1 is only meaningful for
 * the base currency itself.
 */
export async function resolveDocumentCurrency(code: string, rate: number) {
  const currency = await prisma.currency.findFirst({
    where: { code: code.toUpperCase(), isActive: true },
  });

  if (!currency) {
    throw new AppError(
      `Currency "${code}" is not configured in Master Data. Add it before generating a document in it.`,
      400
    );
  }

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new AppError('Enter an exchange rate greater than zero.', 400);
  }

  if (currency.code === BASE_CURRENCY_CODE && Math.abs(rate - 1) > 0.000001) {
    throw new AppError(
      `${BASE_CURRENCY_CODE} is the base currency, so its exchange rate must be 1.`,
      400
    );
  }

  if (currency.code !== BASE_CURRENCY_CODE && Math.abs(rate - 1) < 0.000001) {
    throw new AppError(
      `A rate of 1 would mean 1 ${currency.code} = 1 ${BASE_CURRENCY_CODE}. ` +
        `Enter how many ${BASE_CURRENCY_CODE} one ${currency.code} is worth.`,
      400
    );
  }

  return currency;
}

/**
 * Convert an INR amount into the document currency.
 *
 * `rate` is INR per one unit of the target currency - the way an exporter states
 * it ("1 USD = 95.65"), so the conversion is a division.
 *
 * Rounding is left to the caller: a document has to be internally consistent
 * (quantity x unit price must equal the line amount on every row, because that is
 * what a buyer checks), which means rounding the unit price first and deriving the
 * line from it rather than converting each total independently.
 */
export function toDocumentCurrency(amountInINR: number, rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return amountInINR / rate;
}
