/**
 * Offline verification for shared business logic (no server, no database).
 * Run with:  bun scripts/verify-logic.ts
 */
import {
  formatCurrency,
  formatDate,
  isPastDue,
  daysUntil,
  getStatusColor,
  debounce,
} from '../apps/web/src/lib/utils';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected) || String(actual) === String(expected);
  if (ok) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}\n      expected: ${String(expected)}\n      actual:   ${String(actual)}`);
  }
}

function checkTrue(name: string, cond: boolean) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}`);
  }
}

console.log('--- formatCurrency ---');
checkTrue('USD amount formats with $', formatCurrency(1234.5, 'USD').includes('1,234.50'));
checkTrue('EUR amount formats', formatCurrency(1000, 'EUR').includes('1,000.00'));
check('null amount becomes zero', formatCurrency(null, 'USD'), '$0.00');
check('undefined amount becomes zero', formatCurrency(undefined, 'USD'), '$0.00');
check('numeric string is parsed', formatCurrency('2500.75', 'USD'), '$2,500.75');
check('non-numeric string becomes zero', formatCurrency('abc', 'USD'), '$0.00');
check('missing currency defaults to USD', formatCurrency(10), '$10.00');
// The old implementation threw a RangeError here and blanked the page.
checkTrue(
  'invalid currency code does not throw',
  (() => {
    try {
      const out = formatCurrency(10, 'NOT_A_CODE');
      return typeof out === 'string' && out.includes('10');
    } catch {
      return false;
    }
  })()
);
checkTrue(
  'empty currency string does not throw',
  (() => {
    try {
      return typeof formatCurrency(5, '') === 'string';
    } catch {
      return false;
    }
  })()
);

console.log('\n--- isPastDue (regression: null must not be "overdue") ---');
check('null is not past due', isPastDue(null), false);
check('undefined is not past due', isPastDue(undefined), false);
check('empty string is not past due', isPastDue(''), false);
check('invalid date is not past due', isPastDue('not-a-date'), false);
check('clearly past date is past due', isPastDue('2000-01-01'), true);
check('far future date is not past due', isPastDue('2999-01-01'), false);
const today = new Date();
check('today is not past due', isPastDue(today), false);

console.log('\n--- daysUntil ---');
check('null returns null', daysUntil(null), null);
checkTrue('future date returns positive', (daysUntil('2999-01-01') ?? 0) > 0);
checkTrue('past date returns negative', (daysUntil('2000-01-01') ?? 0) < 0);

console.log('\n--- formatDate ---');
check('null date shows dash', formatDate(null as unknown as string), '-');
check('known date formats', formatDate('2026-03-05', 'YYYY-MM-DD'), '2026-03-05');

console.log('\n--- getStatusColor ---');
check('known status maps to badge', getStatusColor('PAID'), 'badge-success');
check('overdue maps to danger', getStatusColor('OVERDUE'), 'badge-danger');
check('unknown status falls back to gray', getStatusColor('SOMETHING_NEW'), 'badge-gray');

console.log('\n--- margin pricing formula (mirrors NewQuotation) ---');
function price(unitCost: number, margin: number) {
  const safeMargin = Math.min(Math.max(margin, 0), 99);
  const p = unitCost / (1 - safeMargin / 100);
  return Number.isFinite(p) ? Math.round(p * 100) / 100 : 0;
}
check('20% margin on cost 80 gives 100', price(80, 20), 100);
check('0% margin returns cost', price(100, 0), 100);
// Regression: 100% margin used to divide by zero and produce Infinity.
checkTrue('100% margin is finite', Number.isFinite(price(100, 100)) && price(100, 100) > 0);
checkTrue('150% margin is finite and positive', price(100, 150) > 0);
checkTrue('negative margin is clamped to cost', price(100, -50) === 100);

console.log('\n--- debounce ---');

async function main() {
  let calls = 0;
  const fn = debounce(() => calls++, 20);
  fn();
  fn();
  fn();
  await new Promise((r) => setTimeout(r, 60));
  check('rapid calls collapse into one', calls, 1);

  console.log(
    failures === 0
      ? '\nRESULT: all logic checks passed'
      : `\nRESULT: ${failures} logic check(s) FAILED`
  );
  if (failures > 0) process.exit(1);
}

void main();
