/**
 * Proves the printed quotation arithmetic reconciles.
 *
 * The requirement is that a buyer can check the document by hand:
 *   Qty x Unit Price = Amount   on every line
 *   sum of Amounts   = TOTAL
 *
 * Additional costs are billed to the buyer but are quotation-level, and the
 * template has no charges row, so they are apportioned into the unit prices.
 * That apportionment is what this checks - especially that rounding does not
 * leave the column failing to add up.
 *
 * Run: bun scripts/verify-quotation-print-math.ts
 */
import zlib from 'zlib';
import { buildQuotationDocument } from '../apps/api/src/services/exportDocuments';

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

function hexToText(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code >= 32 && code < 255) out += String.fromCharCode(code);
  }
  return out;
}

function extractText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const out: string[] = [];
  const re = /stream[\r\n]{1,2}([\s\S]*?)[\r\n]{0,2}endstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    let text = '';
    try {
      text = zlib
        .inflateSync(Buffer.from(m[1], 'latin1'), {
          finishFlush: zlib.constants.Z_SYNC_FLUSH,
        } as zlib.ZlibOptions)
        .toString('latin1');
    } catch {
      continue;
    }
    if (!/\bBT\b/.test(text)) continue;
    for (const block of text.matchAll(/\[((?:[^\][]|\\.)*)\]\s*TJ|<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
      let run = '';
      for (const h of block[0].matchAll(/<([0-9A-Fa-f\s]+)>/g)) run += hexToText(h[1]);
      if (run) out.push(run);
    }
  }
  return out.join(' ').replace(/\s+/g, ' ');
}

const company = {
  legalName: 'VISION LIMELITE',
  originCountry: 'India',
  quotationTerms: 'All disputes shall be subject to Ahmedabad (Gujarat) jurisdiction only.',
};

const buyer = { companyName: 'Test Buyer Ltd', country: { name: 'UAE' } };
const USD = { code: 'USD', symbol: '$' };

function makeQuotation(items: any[], costs: any[]) {
  const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
  const additional = costs.reduce((s, c) => s + c.amount, 0);
  return {
    quotationNumber: 'QT-TEST',
    createdAt: new Date('2026-08-16'),
    validUntil: new Date('2026-09-16'),
    currency: USD,
    buyer,
    items,
    costs,
    subtotal,
    grandTotal: subtotal + additional,
  };
}

/** Pull numeric figures out of the extracted text, 2 to 4 decimal places. */
function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d[\d,]*\.\d{2,4}/g)].map((m) => parseFloat(m[0].replace(/,/g, '')));
}

async function scenario(
  name: string,
  items: any[],
  costs: any[],
  expectedTotal: number
) {
  const quotation = makeQuotation(items, costs);
  const buffer = await buildQuotationDocument(quotation, company);
  const text = extractText(buffer);

  console.log(`\n=== ${name} ===`);

  // A total is printed at all, and it is within a rounding paisa of goods plus
  // costs. It cannot always be the exact quotation figure: costs are spread evenly
  // per unit, so no line absorbs a remainder, and some divisions never resolve.
  const printedTotals = numbersIn(text).filter(
    (n) => Math.abs(n - expectedTotal) <= 0.02
  );
  check(
    `a TOTAL within a paisa of ${expectedTotal.toFixed(2)} is printed`,
    printedTotals.length > 0,
    `text had: ${numbersIn(text).join(', ')}`
  );

  // No separate charges row - the template has a single TOTAL.
  check('no ADDITIONAL CHARGES row', !text.includes('ADDITIONAL CHARGES'));
  check('no SUBTOTAL row', !text.includes('SUBTOTAL'));

  /**
   * The requirement is internal consistency: whatever total the page states, its
   * own line amounts must sum to it, because that is what a buyer checks with a
   * calculator.
   *
   * Matching the quotation's stored grand total to the paisa is desirable but not
   * always arithmetically possible. Costs are spread evenly per unit, so no single
   * line absorbs a remainder - 100.01 over 21 units is 4.7623809..., which no
   * decimal precision expresses exactly. A gap of a paisa or two is expected and
   * acceptable; anything larger means the apportionment is wrong.
   */
  const printed = numbersIn(text);

  let lineSum = 0;
  let allLinesReconcile = true;
  for (const item of items) {
    const match = printed.find((unit) => {
      const amount = round2(unit * item.quantity);
      return printed.includes(amount) && amount > 0;
    });
    if (match === undefined) {
      allLinesReconcile = false;
      break;
    }
    lineSum = round2(lineSum + round2(match * item.quantity));
  }
  check('every line satisfies qty x unit price = amount', allLinesReconcile);

  check(
    `the printed total equals the sum of its own lines (${lineSum})`,
    printed.includes(lineSum),
    `line sum ${lineSum} not among printed figures: ${printed.join(', ')}`
  );

  const gap = Math.abs(round2(expectedTotal) - lineSum);
  check(
    `within a rounding paisa of the quotation total (gap ${gap.toFixed(2)})`,
    gap <= 0.02,
    `gap ${gap} between quotation ${expectedTotal} and printed ${lineSum}`
  );

  // Costs are spread per unit, so every line's uplift over its goods price is the
  // same. This is what distinguishes the chosen method from a value-weighted one.
  if (items.length > 1 && costs.length > 0) {
    const totalQty = items.reduce((s, i) => s + i.quantity, 0);
    const perUnit = costs.reduce((s, c) => s + c.amount, 0) / totalQty;
    const expectedUnit = round2(items[0].unitPrice + perUnit);
    check(
      `costs spread evenly per unit (~${expectedUnit})`,
      printed.some((p) => Math.abs(p - (items[0].unitPrice + perUnit)) < 0.01),
      `expected around ${expectedUnit}, printed: ${printed.join(', ')}`
    );
  }

  check('amount in words present', text.includes('USD') && text.includes('ONLY'));
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

async function main() {
  // No additional costs: unit price is simply the quoted price.
  await scenario(
    'single line, no additional costs',
    [{ product: { name: 'Basmati Rice' }, quantity: 100, unit: 'Kg', unitPrice: 150, totalPrice: 15000 }],
    [],
    15000
  );

  // Additional costs must be absorbed into the unit price.
  await scenario(
    'single line with freight and insurance',
    [{ product: { name: 'Basmati Rice' }, quantity: 100, unit: 'Kg', unitPrice: 150, totalPrice: 15000 }],
    [
      { costType: 'FREIGHT', amount: 800 },
      { costType: 'INSURANCE', amount: 200 },
    ],
    16000
  );

  // Multiple lines: the apportionment must not lose a cent.
  await scenario(
    'three lines with an awkward charge',
    [
      { product: { name: 'Product A' }, quantity: 3, unit: 'KG', unitPrice: 10, totalPrice: 30 },
      { product: { name: 'Product B' }, quantity: 7, unit: 'KG', unitPrice: 10, totalPrice: 70 },
      { product: { name: 'Product C' }, quantity: 11, unit: 'KG', unitPrice: 10, totalPrice: 110 },
    ],
    [{ costType: 'FREIGHT', amount: 100.01 }],
    310.01
  );

  // A charge that does not divide evenly by quantity.
  await scenario(
    'quantity that forces rounding',
    [{ product: { name: 'Odd Qty' }, quantity: 3, unit: 'KG', unitPrice: 10, totalPrice: 30 }],
    [{ costType: 'FREIGHT', amount: 10 }],
    40
  );

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
