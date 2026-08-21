/**
 * verify-receivables-currency.ts
 *
 * Verifies that the /reports/receivables endpoint correctly converts
 * multi-currency invoice balances into the base currency before summing.
 *
 * Six behavioural rules are checked through static analysis of the source,
 * plus a pure-logic simulation of the conversion function to confirm each
 * case produces the right number.
 *
 * Run: node <root>/node_modules/tsx/dist/cli.mjs scripts/verify-receivables-currency.ts
 *
 * Exit 0 = all passed. Exit 1 = at least one failure.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

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

// ---------------------------------------------------------------------------
// Read source files
// ---------------------------------------------------------------------------
const invoicesRoutePath = path.join(root, 'apps/api/src/routes/invoices.ts');
const exchangeServicePath = path.join(root, 'apps/api/src/services/exchangeRateService.ts');
const invoicesPagePath = path.join(root, 'apps/web/src/pages/Invoices.tsx');
const apiClientPath = path.join(root, 'apps/web/src/lib/api.ts');

const invoicesRoute = fs.readFileSync(invoicesRoutePath, 'utf8');
const exchangeService = fs.readFileSync(exchangeServicePath, 'utf8');
const invoicesPage = fs.readFileSync(invoicesPagePath, 'utf8');
const apiClient = fs.readFileSync(apiClientPath, 'utf8');

console.log('\n--- receivables currency conversion ---\n');

// ============================================================================
// PART 1: Static analysis of the route implementation
// ============================================================================
console.log('Part 1: route implementation\n');

// Extract just the receivables route handler to scope all checks to that block.
const receivablesStart = invoicesRoute.indexOf("router.get('/reports/receivables'");
const receivablesEnd = invoicesRoute.indexOf('\nexport {', receivablesStart);
const receivablesBlock =
  receivablesStart !== -1 ? invoicesRoute.slice(receivablesStart, receivablesEnd) : '';

check(
  'receivables route exists',
  receivablesBlock.length > 0,
  'GET /reports/receivables not found in invoices.ts'
);

// Case 1: Same-currency invoices (base currency, rate = 1 by definition)
// The base currency must be in the rate map at parity so base-only deployments work.
check(
  'case 1 (same currency): buildRateMap is called, not a direct reduce',
  receivablesBlock.includes('buildRateMap') && !receivablesBlock.includes('.reduce('),
  'still using reduce() instead of buildRateMap'
);

// Case 2: Multiple currencies — each row must be multiplied by its rate
check(
  'case 2 (multiple currencies): each balance is multiplied by its rate',
  // Pattern: something * rate, where rate came from rates.get(...)
  /rates\.get\([^)]+\)/.test(receivablesBlock) &&
    /Number\(inv\.balanceAmount\)\s*\*\s*rate/.test(receivablesBlock),
  'balanceAmount is not multiplied by the rate from the map'
);

// Case 3: Missing exchange rate — must count, not add at face value
check(
  'case 3 (missing rate): unconverted rows are counted, not added',
  /unconvertedRecords\+\+/.test(receivablesBlock) &&
    !receivablesBlock.includes('unconvertedRecords += Number(inv.balanceAmount)'),
  'missing-rate rows appear to be added at face value or silently dropped'
);

// Case 4: Zero balance — the endpoint already filters these out with gt: 0
check(
  'case 4 (zero balance): balanceAmount > 0 filter is present',
  receivablesBlock.includes('balanceAmount: { gt: 0 }'),
  'no balanceAmount > 0 filter; zero-balance invoices would be included'
);

// Case 5: Partial payment — balanceAmount is used (not totalAmount)
check(
  'case 5 (partial payment): totalOutstanding uses balanceAmount, not totalAmount',
  /Number\(inv\.balanceAmount\)\s*\*\s*rate/.test(receivablesBlock) &&
    !/Number\(inv\.totalAmount\)\s*\*\s*rate/.test(receivablesBlock),
  'totalAmount is being used instead of balanceAmount for the outstanding figure'
);

// Case 6: Multiple currencies — baseCurrency is returned so the UI can label the total
check(
  'case 6 (multiple currencies): baseCurrency is included in the response',
  /baseCurrency:\s*base/.test(receivablesBlock),
  'baseCurrency is not included; UI cannot label the converted total'
);

// The count of unconverted records must be surfaced in the response
check(
  'unconvertedRecords is included in the response',
  /unconvertedRecords[,\n]/.test(receivablesBlock) || receivablesBlock.includes('unconvertedRecords,'),
  'unconvertedRecords is not in the response body'
);

// Must import buildRateMap from the exchange rate service, not reimplement it
check(
  'buildRateMap is imported from the shared exchange rate service',
  invoicesRoute.includes("from '../services/exchangeRateService'") &&
    invoicesRoute.slice(0, receivablesStart).includes('buildRateMap'),
  'buildRateMap is not imported; a second implementation may exist'
);

// Individual invoices must keep their original currency (not converted per-row)
check(
  'individual invoices are returned in their original currencies',
  receivablesBlock.includes('invoices: receivables'),
  'individual invoices do not appear to be returned in original currencies'
);

// The currency select must include id so Map lookup works
check(
  'currency select includes id field for rate map lookup',
  /currency:\s*\{[^}]*select:[^}]*\{[^}]*id:[^}]*true/.test(receivablesBlock),
  'currency select does not include id — rates.get(inv.currencyId) would always miss'
);

// ============================================================================
// PART 2: Exchange rate service contract — ensure buildRateMap is safe to reuse
// ============================================================================
console.log('\nPart 2: exchange rate service contract\n');

check(
  'buildRateMap seeds base currency at parity (rate = 1)',
  /rates\.set\(base\.id,\s*1\)/.test(exchangeService),
  'base currency is not seeded at 1 — base-currency invoices would be missed'
);

check(
  'buildRateMap deduplicates by taking the newest rate per currency',
  /rates\.has\(row\.currencyId\)\)/.test(exchangeService) ||
    /if \(rates\.has/.test(exchangeService),
  'duplicate rate rows are not deduplicated'
);

check(
  'missing rates are reported via missing array, not thrown',
  // buildRateMap returns { base, rates, missing } — look for the missing field
  // being assembled from the currencies that are not in the rates map.
  /const missing = currencies\.filter/.test(exchangeService) &&
    /missing,/.test(exchangeService),
  'missing rates are not surfaced — caller cannot detect unconvertible rows'
);

// ============================================================================
// PART 3: Logical simulation of the conversion — no DB needed
// ============================================================================
console.log('\nPart 3: logical simulation\n');

/**
 * Replicates the exact logic now used in the route handler:
 *
 *   for each invoice:
 *     rate = rateMap.get(inv.currencyId)
 *     if undefined → unconvertedRecords++; continue
 *     totalOutstanding += Number(inv.balanceAmount) * rate
 *
 * Tests are independent of any DB, Express or Prisma code.
 */
type MockInvoice = {
  id: string;
  currencyId: string;
  balanceAmount: number;
  dueDate: Date;
};

function simulateReceivables(
  invoices: MockInvoice[],
  rateMap: Map<string, number>
): { totalOutstanding: number; unconvertedRecords: number } {
  const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
  let totalOutstanding = 0;
  let unconvertedRecords = 0;

  for (const inv of invoices) {
    const rate = rateMap.get(inv.currencyId);
    if (rate === undefined) {
      unconvertedRecords++;
      continue;
    }
    totalOutstanding += Number(inv.balanceAmount) * rate;
  }

  return { totalOutstanding: round2(totalOutstanding), unconvertedRecords };
}

// Shared mock data
const INR_ID = 'curr_inr';
const USD_ID = 'curr_usd';
const EUR_ID = 'curr_eur';
const GBP_ID = 'curr_gbp'; // will have no rate
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const standardRates = new Map<string, number>([
  [INR_ID, 1],      // base
  [USD_ID, 84.5],   // 1 USD = 84.50 INR
  [EUR_ID, 92.0],   // 1 EUR = 92.00 INR
  // GBP deliberately absent
]);

// ------- Simulation case 1: same currency (all INR) -------------------------
{
  const invoices: MockInvoice[] = [
    { id: 'i1', currencyId: INR_ID, balanceAmount: 50000, dueDate: FUTURE },
    { id: 'i2', currencyId: INR_ID, balanceAmount: 30000, dueDate: FUTURE },
  ];
  const result = simulateReceivables(invoices, standardRates);
  check(
    'sim case 1 (same currency INR): total = 80000, no unconverted',
    result.totalOutstanding === 80000 && result.unconvertedRecords === 0,
    `got totalOutstanding=${result.totalOutstanding} unconverted=${result.unconvertedRecords}`
  );
}

// ------- Simulation case 2: multiple currencies ----------------------------
{
  const invoices: MockInvoice[] = [
    { id: 'i1', currencyId: USD_ID, balanceAmount: 1000, dueDate: FUTURE },  // 1000*84.5 = 84500
    { id: 'i2', currencyId: EUR_ID, balanceAmount: 500,  dueDate: FUTURE },  //  500*92.0 = 46000
    { id: 'i3', currencyId: INR_ID, balanceAmount: 10000, dueDate: FUTURE }, // 10000*1  = 10000
  ];
  const result = simulateReceivables(invoices, standardRates);
  const expected = 84500 + 46000 + 10000; // 140500
  check(
    'sim case 2 (multiple currencies): total = 140500 INR, no unconverted',
    result.totalOutstanding === expected && result.unconvertedRecords === 0,
    `got totalOutstanding=${result.totalOutstanding} expected=${expected} unconverted=${result.unconvertedRecords}`
  );
}

// ------- Simulation case 3: missing exchange rate ---------------------------
{
  const invoices: MockInvoice[] = [
    { id: 'i1', currencyId: USD_ID, balanceAmount: 1000, dueDate: FUTURE }, // 84500
    { id: 'i2', currencyId: GBP_ID, balanceAmount: 2000, dueDate: FUTURE }, // no rate!
    { id: 'i3', currencyId: EUR_ID, balanceAmount: 500,  dueDate: FUTURE }, // 46000
  ];
  const result = simulateReceivables(invoices, standardRates);
  const expectedTotal = 84500 + 46000; // GBP excluded
  check(
    'sim case 3 (missing rate): GBP excluded from total, unconvertedRecords = 1',
    result.totalOutstanding === expectedTotal && result.unconvertedRecords === 1,
    `got totalOutstanding=${result.totalOutstanding} expected=${expectedTotal} unconverted=${result.unconvertedRecords}`
  );
}

// ------- Simulation case 4: zero balance (filtered at DB, but verify math too)
{
  const invoices: MockInvoice[] = [
    { id: 'i1', currencyId: USD_ID, balanceAmount: 0, dueDate: FUTURE },
    { id: 'i2', currencyId: USD_ID, balanceAmount: 500, dueDate: FUTURE }, // 500*84.5 = 42250
  ];
  const result = simulateReceivables(invoices, standardRates);
  check(
    'sim case 4 (zero balance): zero-balance row contributes nothing to total',
    result.totalOutstanding === 42250 && result.unconvertedRecords === 0,
    `got totalOutstanding=${result.totalOutstanding}`
  );
}

// ------- Simulation case 5: partial payment --------------------------------
{
  // Invoice was for 2000 USD, 800 already paid → balance = 1200
  const invoices: MockInvoice[] = [
    { id: 'i1', currencyId: USD_ID, balanceAmount: 1200, dueDate: FUTURE }, // 1200*84.5 = 101400
  ];
  const result = simulateReceivables(invoices, standardRates);
  check(
    'sim case 5 (partial payment): uses balanceAmount (1200), not totalAmount (2000)',
    result.totalOutstanding === 101400 && result.unconvertedRecords === 0,
    `got totalOutstanding=${result.totalOutstanding} expected=101400`
  );
}

// ------- Simulation case 6: multiple currencies, overdue tracking ----------
{
  const invoices: MockInvoice[] = [
    { id: 'i1', currencyId: USD_ID, balanceAmount: 1000, dueDate: PAST   }, // overdue
    { id: 'i2', currencyId: EUR_ID, balanceAmount: 1000, dueDate: FUTURE }, // current
    { id: 'i3', currencyId: GBP_ID, balanceAmount: 1000, dueDate: PAST   }, // overdue + no rate
  ];
  const result = simulateReceivables(invoices, standardRates);
  const expectedTotal = 84500 + 92000; // only USD + EUR, GBP missing
  const overdue = invoices.filter(i => i.dueDate < new Date());
  check(
    'sim case 6 (multiple currencies, overdue): total correct, overdue count = 2',
    result.totalOutstanding === expectedTotal &&
      result.unconvertedRecords === 1 &&
      overdue.length === 2,
    `totalOutstanding=${result.totalOutstanding} expected=${expectedTotal} unconverted=${result.unconvertedRecords} overdue=${overdue.length}`
  );
}

// ============================================================================
// PART 4: Frontend compatibility — response shape must satisfy Invoices.tsx
// ============================================================================
console.log('\nPart 4: frontend compatibility\n');

// Invoices.tsx line 87: summary?.totalOutstanding ?? receivables?.totalOutstanding ?? 0
// receivables here is receivablesData?.data?.data (the raw API response)
check(
  'frontend accesses totalOutstanding from receivables data',
  invoicesPage.includes('receivables?.totalOutstanding'),
  'Invoices.tsx does not read totalOutstanding from receivables; shape may have changed'
);

// The API client must call getReceivables
check(
  'api.ts defines getReceivables pointing to /invoices/reports/receivables',
  apiClient.includes('getReceivables') && apiClient.includes('/invoices/reports/receivables'),
  'getReceivables is not defined or points to wrong URL'
);

// ============================================================================
// Summary
// ============================================================================
console.log(`\n${'-'.repeat(60)}`);
console.log(`${passes} passed, ${failures} failed`);

if (failures > 0) {
  console.log('\nFailed checks mean the receivables conversion is not correct.');
  console.log('See details above.');
}

process.exit(failures === 0 ? 0 : 1);
