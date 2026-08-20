/**
 * Verifies the all-inclusive unit price reconciles at every step.
 *
 * The defect this guards against: a quotation stored goods-only line prices while
 * its grandTotal included the additional costs, and the order copied both. So the
 * order's lines summed to less than the order's own total, and the commercial
 * invoice printed lines that disagreed with its total.
 *
 * The rule being enforced:
 *   unit price = supplier price + margin + (additional costs / total quantity)
 *   sum of (qty x unit price) = the buyer's grand total, exactly
 *
 * Run: bun scripts/verify-inclusive-pricing.ts
 */
import { calculateInclusiveUnitPrices } from '../apps/api/src/services/inclusivePricing';

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

function round2(v: number) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

interface Scenario {
  name: string;
  items: { quantity: number; unitPrice: number }[];
  additional: number;
}

const scenarios: Scenario[] = [
  {
    name: 'no additional costs',
    items: [{ quantity: 100, unitPrice: 150 }],
    additional: 0,
  },
  {
    name: 'the reported case: 100kg psyllium + freight',
    items: [{ quantity: 100, unitPrice: 1440.78 }],
    additional: 12000,
  },
  {
    name: 'two lines, very different values',
    items: [
      { quantity: 100, unitPrice: 1440.78 },
      { quantity: 200, unitPrice: 55 },
    ],
    additional: 12000,
  },
  {
    name: 'costs that do not divide evenly',
    items: [{ quantity: 3, unitPrice: 10 }],
    additional: 40,
  },
  {
    name: 'three lines, awkward remainder',
    items: [
      { quantity: 7, unitPrice: 12.5 },
      { quantity: 11, unitPrice: 8.25 },
      { quantity: 13, unitPrice: 99.99 },
    ],
    additional: 1000.01,
  },
  {
    name: 'large quantities, small costs',
    items: [{ quantity: 25000, unitPrice: 42.5 }],
    additional: 137.77,
  },
  {
    name: 'single unit',
    items: [{ quantity: 1, unitPrice: 5 }],
    additional: 2.5,
  },
];

for (const s of scenarios) {
  console.log(`\n=== ${s.name} ===`);

  const goodsTotal = s.items.reduce((t, i) => t + i.unitPrice * i.quantity, 0);
  const grandTotal = round2(goodsTotal + s.additional);
  const totalQty = s.items.reduce((t, i) => t + i.quantity, 0);

  const result = calculateInclusiveUnitPrices(s.items, s.additional);

  console.log(
    `  goods ${goodsTotal.toFixed(2)} + costs ${s.additional.toFixed(2)} = ${grandTotal.toFixed(2)}   (${result.decimals}dp)`
  );

  // The headline requirement is internal consistency: whatever total the document
  // states, its own lines must sum to it. That is what a buyer or customs officer
  // verifies with a calculator.
  const lineSum = round2(result.lines.reduce((t, l) => t + l.amount, 0));
  check(
    `the stated total equals the sum of its lines (${lineSum.toFixed(2)})`,
    Math.abs(lineSum - result.total) < 0.005,
    `lines ${lineSum} vs stated ${result.total}`
  );

  // Matching the quotation exactly is desirable but not always arithmetically
  // possible; when it is not, the shortfall must be reported rather than hidden.
  if (result.reconciled) {
    check(
      `matches the quotation grand total (${grandTotal.toFixed(2)})`,
      Math.abs(result.total - grandTotal) < 0.005
    );
  } else {
    check(
      `unreconcilable remainder is reported (${result.remainder})`,
      Math.abs(result.remainder) > 0 &&
        Math.abs(round2(grandTotal - result.total) - result.remainder) < 0.005,
      `remainder ${result.remainder}, actual gap ${round2(grandTotal - result.total)}`
    );
    console.log(`    note: ${result.remainder} cannot be expressed at 6dp per unit`);
  }

  // Every line must satisfy qty x unit = amount, so a buyer can check by hand.
  let allLines = true;
  for (const line of result.lines) {
    const expected = round2(line.unitPrice * line.quantity);
    if (Math.abs(expected - line.amount) > 0.005) allLines = false;
    console.log(
      `    ${String(line.quantity).padStart(6)} x ${line.unitPrice.toFixed(line.decimals).padStart(12)} = ${line.amount.toFixed(2).padStart(12)}`
    );
  }
  check('every line satisfies qty x unit price = amount', allLines);

  // The per-unit cost must follow the stated formula, not a value-weighted share.
  const expectedPerUnit = totalQty > 0 ? s.additional / totalQty : 0;
  check(
    `per-unit cost is costs / total quantity (${result.perUnitCost.toFixed(4)})`,
    Math.abs(result.perUnitCost - expectedPerUnit) < 0.00001,
    `expected ${expectedPerUnit.toFixed(4)}`
  );

  // Costs spread evenly, so every line's uplift over its goods price is equal.
  if (s.items.length > 1 && s.additional > 0) {
    const uplifts = result.lines.map((l, idx) => round2(l.unitPrice - s.items[idx].unitPrice));
    const spread = Math.max(...uplifts) - Math.min(...uplifts);
    check(
      `every line carries the same cost per unit (spread ${spread.toFixed(4)})`,
      spread < 0.01,
      `uplifts: ${uplifts.join(', ')}`
    );
  }
}

console.log(`\n${'-'.repeat(60)}`);
console.log(`${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
