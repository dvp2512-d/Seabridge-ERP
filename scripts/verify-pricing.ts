/**
 * Pricing engine verification.
 *
 * Checks the browser implementation against hand-worked numbers, and asserts it
 * agrees with the server implementation for the same inputs.
 *
 *   bun scripts/verify-pricing.ts
 */
import {
  calculateLinePricing as clientCalc,
  type PricingComponent,
} from '../apps/web/src/lib/pricing';
import {
  calculateLinePricing as serverCalc,
  calculateQuotationTotals,
  type PricingComponentInput,
} from '../apps/api/src/services/pricingService';

let failures = 0;

function check(name: string, actual: number, expected: number) {
  const ok = Math.abs(actual - expected) < 0.01;
  if (ok) console.log(`PASS: ${name}  (${actual})`);
  else {
    failures++;
    console.log(`FAIL: ${name}\n      expected ${expected}, got ${actual}`);
  }
}

function checkTrue(name: string, cond: boolean) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}`);
  }
}

/** Build the same component list for both implementations. */
function make(
  rows: [string, PricingComponent['calcType'], number, boolean?, boolean?][]
): { client: PricingComponent[]; server: PricingComponentInput[] } {
  return {
    client: rows.map(([name, calcType, value, isMargin, isProductPrice], i) => ({
      key: String(i),
      name,
      calcType,
      value: String(value),
      isMargin: isMargin ?? false,
      isProductPrice: isProductPrice ?? false,
      sortOrder: i,
    })),
    server: rows.map(([name, calcType, value, isMargin, isProductPrice], i) => ({
      name,
      calcType,
      value,
      isMargin: isMargin ?? false,
      isProductPrice: isProductPrice ?? false,
      sortOrder: i,
    })),
  };
}

console.log('--- Worked example: 25 MT of rice ---');
// Supplier 850/MT  = 21,250   <- BASE for margin
// Packaging 20/MT  =    500
// CHA fixed        =    450
// Local transport  =    300
// Sea freight      =  1,200
// Inspection fixed =    250
// Insurance 0.5%   of all cost components
// Margin 15%       of the SUPPLIER PRICE ONLY
const qty = 25;
const ex = make([
  ['Product Price (Supplier)', 'PER_UNIT', 850, false, true],
  ['Packaging & Processing', 'PER_UNIT', 20],
  ['CHA / Customs', 'FIXED', 450],
  ['Local Transportation', 'FIXED', 300],
  ['Transportation - Sea', 'FIXED', 1200],
  ['Insurance', 'PERCENT_OF_COST', 0.5],
  ['Inspection', 'FIXED', 250],
  ['Our Margin', 'PERCENT_OF_PRODUCT', 15, true],
]);

const productBase = 21250;                       // supplier price only
const costBase = 23950;                          // all absolute cost components
const insurance = costBase * 0.005;              // 119.75
const marginAmt = productBase * 0.15;            // 3187.50
const expectedCost = costBase + insurance;       // 24,069.75
const expectedTotal = expectedCost + marginAmt;  // 27,257.25

const c = clientCalc(qty, ex.client);
const s = serverCalc(qty, ex.server);

check('margin is 15% of the supplier price only', s.margin, marginAmt);
check('margin ignores freight and other costs', s.margin, 3187.5);
check('insurance is still 0.5% of all costs', s.components[5].amount, insurance);
check('total cost', s.totalCost, expectedCost);
check('line total (buyer pays)', s.totalPrice, expectedTotal);
check('per unit final price', s.unitPrice, expectedTotal / qty);
check('per unit cost', s.unitCost, expectedCost / qty);
check('margin percent of sell price', s.marginPercent, (marginAmt / expectedTotal) * 100);

console.log('\n--- margin basis is independent of other costs ---');
// Adding freight must not change the margin amount, only the total.
const noFreight = serverCalc(10, make([
  ['Supplier', 'PER_UNIT', 100, false, true],
  ['Margin', 'PERCENT_OF_PRODUCT', 20, true],
]).server);
const withFreight = serverCalc(10, make([
  ['Supplier', 'PER_UNIT', 100, false, true],
  ['Freight', 'FIXED', 5000],
  ['Margin', 'PERCENT_OF_PRODUCT', 20, true],
]).server);
check('margin without freight', noFreight.margin, 200);
check('margin unchanged when freight is added', withFreight.margin, 200);
check('total rises by exactly the freight', withFreight.totalPrice - noFreight.totalPrice, 5000);

console.log('\n--- % of total cost still available for insurance-style charges ---');
const ofCost = serverCalc(10, make([
  ['Supplier', 'PER_UNIT', 100, false, true],
  ['Freight', 'FIXED', 500],
  ['Insurance', 'PERCENT_OF_COST', 10],
]).server);
// cost base = 1000 + 500 = 1500, insurance = 150
check('% of total cost uses every cost component', ofCost.components[2].amount, 150);

console.log('\n--- client and server agree ---');
check('totalPrice matches', c.totalPrice, s.totalPrice);
check('totalCost matches', c.totalCost, s.totalCost);
check('margin matches', c.margin, s.margin);
check('unitPrice matches', c.unitPrice, s.unitPrice);
check('marginPercent matches', c.marginPercent, s.marginPercent);

console.log('\n--- every component is charged to the buyer ---');
// Regression guard for the old bug: adding a cost must raise the sell price.
const before = serverCalc(10, make([['Supplier', 'PER_UNIT', 100]]).server);
const after = serverCalc(
  10,
  make([
    ['Supplier', 'PER_UNIT', 100],
    ['CHA', 'FIXED', 500],
  ]).server
);
check('adding CHA raises the line total by exactly the CHA amount', after.totalPrice - before.totalPrice, 500);
checkTrue('adding a cost does not reduce margin', after.margin >= before.margin);

console.log('\n--- ordering does not change the result ---');
const forward = serverCalc(10, make([
  ['Supplier', 'PER_UNIT', 100],
  ['Freight', 'FIXED', 200],
  ['Insurance', 'PERCENT_OF_COST', 2],
  ['Margin', 'PERCENT_OF_COST', 10, true],
]).server);
const reversed = serverCalc(10, make([
  ['Margin', 'PERCENT_OF_COST', 10, true],
  ['Insurance', 'PERCENT_OF_COST', 2],
  ['Freight', 'FIXED', 200],
  ['Supplier', 'PER_UNIT', 100],
]).server);
check('reordering keeps the same total', reversed.totalPrice, forward.totalPrice);

console.log('\n--- edge cases ---');
const zeroQty = serverCalc(0, make([['Supplier', 'PER_UNIT', 100], ['CHA', 'FIXED', 50]]).server);
check('quantity 0 gives unit price 0 instead of Infinity', zeroQty.unitPrice, 0);
checkTrue('quantity 0 total stays finite', Number.isFinite(zeroQty.totalPrice));

const noComponents = serverCalc(10, []);
check('no components gives zero total', noComponents.totalPrice, 0);
check('no components gives zero margin percent', noComponents.marginPercent, 0);

const negative = serverCalc(10, make([['Discount', 'FIXED', -100]]).server);
check('negative component is allowed (discount)', negative.totalPrice, -100);

const nan = serverCalc(10, [
  { name: 'Broken', calcType: 'FIXED', value: NaN as unknown as number },
]);
check('NaN value is treated as 0', nan.totalPrice, 0);

console.log('\n--- quotation totals ---');
const totals = calculateQuotationTotals([
  { totalPrice: 27257.25, totalCost: 24069.75, margin: 3187.5 },
  { totalPrice: 1000, totalCost: 800, margin: 200 },
]);
check('subtotal sums the lines', totals.subtotal, 28257.25);
check('grand total equals subtotal (no second charge)', totals.grandTotal, 28257.25);
check('total cost sums the lines', totals.totalCost, 24869.75);
check('total margin sums the lines', totals.totalMargin, 3387.5);

console.log(
  failures === 0
    ? '\nRESULT: all pricing checks passed'
    : `\nRESULT: ${failures} pricing check(s) FAILED`
);
if (failures > 0) process.exit(1);
