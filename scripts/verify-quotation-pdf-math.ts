/**
 * Verifies the quotation PDF arithmetic reconciles for the buyer:
 *
 *   quantity x unit price = line total
 *   sum of line totals    = grand total
 *
 * Additional charges are apportioned across lines by value and folded into the
 * unit price, so a single-line quote satisfies grand total / qty = unit price.
 *
 * This mirrors the calculation in generateQuotationPDF. Run with:
 *   bun scripts/verify-quotation-pdf-math.ts
 */

let failures = 0;

function money(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function check(name: string, actual: number, expected: number) {
  const ok = Math.abs(actual - expected) < 0.005;
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

interface Line { qty: number; lineTotal: number }

/** Same apportionment the PDF performs. */
function buildRows(lines: Line[], additionalCharges: number) {
  const lineSubtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  let apportioned = 0;

  const rows = lines.map((l, i) => {
    const isLast = i === lines.length - 1;
    let share: number;
    if (isLast) {
      share = money(additionalCharges - apportioned);
    } else {
      share = money(
        lineSubtotal > 0
          ? additionalCharges * (l.lineTotal / lineSubtotal)
          : additionalCharges / Math.max(lines.length, 1)
      );
      apportioned += share;
    }
    const unitPrice = l.qty > 0 ? money((l.lineTotal + share) / l.qty) : 0;
    const total = l.qty > 0 ? money(unitPrice * l.qty) : money(l.lineTotal + share);
    return { ...l, share, unitPrice, total };
  });

  return { rows, documentTotal: money(rows.reduce((s, r) => s + r.total, 0)) };
}

console.log('--- single line: 25 MT, 25,000 goods + 2,000 charges ---');
{
  const { rows, documentTotal } = buildRows([{ qty: 25, lineTotal: 25000 }], 2000);
  const r = rows[0];
  check('unit price = grand total / qty', r.unitPrice, 27000 / 25);
  check('qty x unit price = line total', money(r.qty * r.unitPrice), r.total);
  check('grand total', documentTotal, 27000);
  checkTrue('reconciles exactly', money(r.qty * r.unitPrice) === documentTotal);
}

console.log('\n--- single line, awkward division: 3 MT, 10,000 + 1,000 ---');
{
  const { rows, documentTotal } = buildRows([{ qty: 3, lineTotal: 10000 }], 1000);
  const r = rows[0];
  console.log(`      unit price ${r.unitPrice} x 3 = ${money(r.qty * r.unitPrice)}`);
  check('qty x unit price = printed total', money(r.qty * r.unitPrice), r.total);
  check('grand total equals the line total', documentTotal, r.total);
  checkTrue('page is internally consistent', money(r.qty * r.unitPrice) === documentTotal);
}

console.log('\n--- three lines, charges apportioned by value ---');
{
  const lines = [
    { qty: 10, lineTotal: 10000 },
    { qty: 5, lineTotal: 5000 },
    { qty: 20, lineTotal: 5000 },
  ];
  const { rows, documentTotal } = buildRows(lines, 3000);
  rows.forEach((r, i) =>
    console.log(
      `      line ${i + 1}: qty ${r.qty} x ${r.unitPrice} = ${r.total}  (share of charges ${r.share})`
    )
  );
  rows.forEach((r, i) =>
    check(`line ${i + 1}: qty x unit = total`, money(r.qty * r.unitPrice), r.total)
  );
  check('apportioned charges sum to 3,000', money(rows.reduce((s, r) => s + r.share, 0)), 3000);
  check('grand total = goods 20,000 + charges 3,000', documentTotal, 23000);
  check('larger line carries the larger share', rows[0].share, 1500);
}

console.log('\n--- no additional charges: unit price unchanged ---');
{
  const { rows, documentTotal } = buildRows([{ qty: 25, lineTotal: 25000 }], 0);
  check('unit price is the plain line rate', rows[0].unitPrice, 1000);
  check('grand total is the goods value', documentTotal, 25000);
}

console.log('\n--- edge cases ---');
{
  const zeroQty = buildRows([{ qty: 0, lineTotal: 500 }], 100);
  checkTrue('zero quantity does not produce Infinity', Number.isFinite(zeroQty.rows[0].unitPrice));
  check('zero quantity unit price is 0', zeroQty.rows[0].unitPrice, 0);

  const noLines = buildRows([], 500);
  check('no lines gives a zero document total', noLines.documentTotal, 0);
}

console.log(
  failures === 0
    ? '\nRESULT: quotation PDF arithmetic reconciles'
    : `\nRESULT: ${failures} check(s) FAILED`
);
if (failures > 0) process.exit(1);
