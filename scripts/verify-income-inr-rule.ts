/**
 * Enforces the Other Income reporting rule as a test rather than a convention.
 *
 * The rule: every total, card, breakdown and export sums amountINR only.
 * originalAmount must never be summed across rows, because those rows may be in
 * different currencies and adding them yields a meaningless number.
 *
 * A comment saying so protects nothing - the next person adding a summary view
 * will not read it. This fails the build instead.
 *
 * Run: bun scripts/verify-income-inr-rule.ts
 */
import fs from 'node:fs';
import path from 'node:path';

let passes = 0;
let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? '\n        ' + detail : ''}`);
  }
}

const root = path.resolve(__dirname, '..');

function readFiles(dir: string, exts: string[]): { file: string; content: string }[] {
  const out: { file: string; content: string }[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      out.push(...readFiles(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push({ file: full.replace(root + path.sep, ''), content: fs.readFileSync(full, 'utf8') });
    }
  }
  return out;
}

const sources = [
  ...readFiles(path.join(root, 'apps/api/src'), ['.ts']),
  ...readFiles(path.join(root, 'apps/web/src'), ['.ts', '.tsx']),
];

console.log(`\nscanning ${sources.length} source files\n`);

// ---- 1. originalAmount must never be aggregated ----------------------------
/**
 * Patterns that would sum or average originalAmount. Reading a single row's
 * originalAmount is fine and expected - the table displays it. Aggregating across
 * rows is what must not happen.
 */
const forbidden = [
  { pattern: /_sum:\s*\{[^}]*originalAmount/s, why: 'Prisma _sum over originalAmount' },
  { pattern: /_avg:\s*\{[^}]*originalAmount/s, why: 'Prisma _avg over originalAmount' },
  { pattern: /reduce\([^)]*originalAmount/s, why: 'reduce accumulating originalAmount' },
  { pattern: /SUM\(\s*original_amount/i, why: 'raw SQL SUM(original_amount)' },
];

const offenders: string[] = [];
for (const { file, content } of sources) {
  for (const { pattern, why } of forbidden) {
    if (pattern.test(content)) offenders.push(`${file}: ${why}`);
  }
}
check(
  'originalAmount is never summed or averaged anywhere',
  offenders.length === 0,
  offenders.join('\n        ')
);

// ---- 2. the income API must aggregate amountINR ---------------------------
const incomeRoute = sources.find((s) => s.file.endsWith(path.join('routes', 'income.ts')));
check('income route exists', !!incomeRoute);

if (incomeRoute) {
  check(
    'income summary aggregates amountINR',
    /_sum:\s*\{\s*amountINR:\s*true/.test(incomeRoute.content),
    'no _sum over amountINR found'
  );

  // The stored rupee figure must be derived server-side, never accepted.
  check(
    'amountINR is computed from originalAmount x exchangeRate',
    /toINR\(/.test(incomeRoute.content) &&
      /originalAmount \* exchangeRate/.test(incomeRoute.content),
    'no server-side derivation found'
  );

  check(
    'a client-supplied amountINR cannot be written',
    !/amountINR:\s*(data|req\.body|validation\.data)\.amountINR/.test(incomeRoute.content),
    'amountINR appears to be taken from the request'
  );

  // The create and update schemas must not accept amountINR at all.
  const acceptsInr = /amountINR:\s*z\./.test(incomeRoute.content);
  check('the request schema does not accept amountINR', !acceptsInr);

  check(
    'the base currency cannot carry a rate other than 1',
    /assertRateConsistent/.test(incomeRoute.content),
    'no base-currency rate guard found'
  );

  check(
    'a forex gain must be linked to its invoice',
    /FOREX_GAIN'\s*&&\s*!.*linkedInvoiceId/s.test(incomeRoute.content),
    'no link requirement found for FOREX_GAIN'
  );

  check(
    'currency is validated against the Currency master',
    /assertKnownCurrency/.test(incomeRoute.content),
    'currency is not checked against master data'
  );
}

// ---- 3. the dashboard must keep income out of revenue --------------------
const dashboard = sources.find((s) => s.file.endsWith(path.join('routes', 'dashboard.ts')));
if (dashboard) {
  check(
    'dashboard reports otherIncome separately',
    /otherIncome:\s*\{/.test(dashboard.content),
    'no separate otherIncome block'
  );

  // Revenue must be built from payments alone. If income ever leaks into those
  // sums, the figure stops meaning export sales.
  const revenueBlock = dashboard.content.slice(
    dashboard.content.indexOf('const monthlyRevenue'),
    dashboard.content.indexOf('const unconverted')
  );
  check(
    'revenue totals do not include income',
    !/income/i.test(revenueBlock),
    'income appears inside the revenue calculation'
  );
}

// ---- 4. the UI must label income figures as INR --------------------------
const incomePage = sources.find((s) => s.file.endsWith(path.join('pages', 'Income.tsx')));
if (incomePage) {
  check(
    'summary cards state INR explicitly',
    /formatCurrency\([^)]*,\s*'INR'\)/.test(incomePage.content),
    'income figures are not explicitly labelled INR'
  );

  check(
    'the row shows the original amount and its currency together',
    /originalCurrency/.test(incomePage.content),
    'the original currency is not displayed, so the conversion would be hidden'
  );
}

console.log(`\n${'-'.repeat(60)}`);
console.log(`${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
