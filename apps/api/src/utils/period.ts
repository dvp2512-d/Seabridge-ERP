/**
 * Reporting period boundaries.
 *
 * Every "yearly" figure in this system uses the Indian financial year, 1 April to
 * 31 March, because that is the year the business is actually accounted for. The
 * dashboard previously used the calendar year, which counted January to March
 * against the wrong year and made its totals disagree with the books by three
 * months of activity.
 *
 * Kept in one place so a new report cannot pick a different definition and
 * quietly disagree with the others.
 */

/**
 * Start of the financial year containing the given date.
 *
 * Before April the current financial year began in the previous calendar year, so
 * 20 March 2026 belongs to the year that started 1 April 2025.
 *
 * Built in UTC deliberately. A local-midnight boundary in IST is 18:30 the
 * previous day in UTC, which against a DATE column would pull a 31 March entry
 * into the following financial year - an off-by-one that would only ever show up
 * at year end, and only for a handful of records.
 */
export function startOfFinancialYear(reference: Date = new Date()): Date {
  const year = reference.getMonth() >= 3 ? reference.getFullYear() : reference.getFullYear() - 1;
  return new Date(Date.UTC(year, 3, 1));
}

/** End of that financial year: 31 March, inclusive, in UTC for the same reason. */
export function endOfFinancialYear(reference: Date = new Date()): Date {
  const start = startOfFinancialYear(reference);
  return new Date(Date.UTC(start.getUTCFullYear() + 1, 2, 31, 23, 59, 59, 999));
}

/** Start of the calendar month containing the given date. */
export function startOfMonth(reference: Date = new Date()): Date {
  return new Date(Date.UTC(reference.getFullYear(), reference.getMonth(), 1));
}

/**
 * Human label for the financial year, e.g. "FY 2026-27".
 *
 * Returned with the figures so a screen can state which year it is showing
 * instead of leaving the reader to assume.
 */
export function financialYearLabel(reference: Date = new Date()): string {
  const start = startOfFinancialYear(reference);
  const endShort = String((start.getUTCFullYear() + 1) % 100).padStart(2, '0');
  return `FY ${start.getUTCFullYear()}-${endShort}`;
}
