/**
 * Verifies the financial year boundaries, including the year-end edge where an
 * off-by-one would put a 31 March receipt in the wrong year.
 *
 * The dashboard previously used the calendar year, so January to March counted
 * against the following year and every yearly total disagreed with the books by
 * three months. These assertions pin the corrected behaviour.
 *
 * Run: bun scripts/verify-financial-year.ts
 */
import {
  startOfFinancialYear,
  endOfFinancialYear,
  financialYearLabel,
} from '../apps/api/src/utils/period';

let passes = 0;
let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

/** Date-only comparison, since that is how the columns are stored. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface Case {
  date: string;
  label: string;
  start: string;
}

const cases: Case[] = [
  // Inside the year that began the previous April
  { date: '2026-01-15', label: 'FY 2025-26', start: '2025-04-01' },
  { date: '2026-02-28', label: 'FY 2025-26', start: '2025-04-01' },
  // The last day of the old year
  { date: '2026-03-31', label: 'FY 2025-26', start: '2025-04-01' },
  // The first day of the new one
  { date: '2026-04-01', label: 'FY 2026-27', start: '2026-04-01' },
  { date: '2026-08-20', label: 'FY 2026-27', start: '2026-04-01' },
  { date: '2026-12-31', label: 'FY 2026-27', start: '2026-04-01' },
  { date: '2027-03-31', label: 'FY 2026-27', start: '2026-04-01' },
  { date: '2027-04-01', label: 'FY 2027-28', start: '2027-04-01' },
];

console.log('\n=== financial year for a given date ===');
for (const c of cases) {
  // Midday, so a timezone shift cannot move the date itself
  const ref = new Date(`${c.date}T12:00:00Z`);
  const label = financialYearLabel(ref);
  const start = isoDate(startOfFinancialYear(ref));

  check(`${c.date} is ${c.label}`, label === c.label, `got ${label}`);
  check(`${c.date} starts ${c.start}`, start === c.start, `got ${start}`);
}

console.log('\n=== the boundary lands on 1 April, not 31 March ===');
/**
 * The reason this matters: a local-midnight boundary in IST is 18:30 the previous
 * day in UTC. Against a DATE column that would include 31 March in the new year.
 */
const aug = new Date('2026-08-20T12:00:00Z');
const start = startOfFinancialYear(aug);
check('start is exactly 1 April in UTC', isoDate(start) === '2026-04-01', isoDate(start));
check('start is midnight UTC', start.getUTCHours() === 0 && start.getUTCMinutes() === 0);

// A receipt on 31 March must fall before the boundary, not on or after it.
const march31 = new Date('2026-03-31T00:00:00Z');
check(
  '31 March falls before the FY 2026-27 boundary',
  march31.getTime() < start.getTime(),
  `${isoDate(march31)} vs boundary ${isoDate(start)}`
);

const april1 = new Date('2026-04-01T00:00:00Z');
check(
  '1 April falls on or after the boundary',
  april1.getTime() >= start.getTime(),
  `${isoDate(april1)} vs boundary ${isoDate(start)}`
);

console.log('\n=== the year ends on 31 March ===');
const end = endOfFinancialYear(aug);
check('end is 31 March of the next year', isoDate(end) === '2027-03-31', isoDate(end));
check('end is the last moment of the day', end.getUTCHours() === 23);

console.log('\n=== consecutive years are contiguous with no gap or overlap ===');
const thisStart = startOfFinancialYear(new Date('2026-08-20T12:00:00Z'));
const prevEnd = endOfFinancialYear(new Date('2026-01-15T12:00:00Z'));
const gapMs = thisStart.getTime() - prevEnd.getTime();
check(
  'the previous year ends immediately before this one starts',
  gapMs > 0 && gapMs < 1000,
  `gap of ${gapMs}ms`
);

console.log(`\n${'-'.repeat(60)}`);
console.log(`${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
