/**
 * Inclusive Pricing Calculator
 *
 * Folds a quotation's additional costs (freight, insurance, CHA, handling) into
 * the unit prices, so a document with a single total column adds up: quantity x
 * unit price equals the line amount on every row, and the amounts sum to the
 * quoted grand total.
 *
 * A quotation stores the goods price and the cost rows separately, which is what
 * makes margin measurable per line. Orders, invoices and the printed quotation
 * cannot do that - they carry one figure per line - so this is where the two
 * views are reconciled.
 *
 * THE MATH:
 *   perUnitCost        = additionalCosts / totalQuantity
 *   inclusiveUnitPrice = originalUnitPrice + perUnitCost
 *   lineAmount         = inclusiveUnitPrice * quantity
 *   total              = sum of all line amounts
 *
 * Costs are spread evenly per unit rather than by line value. They are
 * overwhelmingly freight and handling, which follow weight and volume rather
 * than what the goods are worth; loading them by value inflates an expensive line
 * and under-recovers on a cheap one. Spreading 12,000 across 100kg of psyllium
 * and 200kg of rice gives 111.49 and 4.26 per unit by value, against 40.00 each
 * by quantity.
 *
 * PRECISION:
 *   Two decimals cannot always reconcile: 40.00 of cost over 3 units is
 *   13.333..., and 13.33 x 3 = 39.99, a paisa short. So the smallest precision
 *   from two to six decimals that makes the amounts sum to the true total is
 *   used, which is how export invoices handle it in practice. `decimals` reports
 *   the precision chosen so callers print the unit price exactly as it was used -
 *   printing a 5dp price rounded to 2dp is what makes a row fail a buyer's
 *   calculator.
 *
 *   Very large quantities can defeat even six decimals: 137.77 spread over 25,000
 *   units is 0.0055108 each, and no sensible unit price carries that exactly. In
 *   that case the lines remain internally consistent - which is what a buyer
 *   verifies - and `remainder` reports the shortfall against the quoted total so
 *   the caller can decide whether it matters. It is not treated as a failure,
 *   because refusing an order over a paisa is worse than the paisa.
 */

interface InputLine {
  quantity: number;
  unitPrice: number;
}

interface OutputLine {
  /** Goods price plus the apportioned cost, at `decimals` precision */
  unitPrice: number;
  quantity: number;
  /** quantity x unitPrice, rounded to two decimals */
  amount: number;
  /** Decimal places used for unitPrice, so callers can print it consistently */
  decimals: number;
}

interface InclusivePricingResult {
  lines: OutputLine[];
  /** Sum of the line amounts. The figure an order or invoice should store. */
  total: number;
  /** Additional cost carried by each unit, before rounding */
  perUnitCost: number;
  /** Precision used for the unit prices */
  decimals: number;
  /** True when the amounts sum to the quoted grand total */
  reconciled: boolean;
  /** quotedTotal - total; non-zero only when no precision could reconcile */
  remainder: number;
}

/** Round to 2 decimal places, handling floating-point edge cases. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Round to N decimal places. */
function roundN(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Calculate inclusive unit prices by spreading additional costs evenly per unit.
 *
 * @param items - Line items with quantity and original (goods-only) unit price
 * @param additionalCosts - Total additional costs to spread
 */
export function calculateInclusiveUnitPrices(
  items: InputLine[],
  additionalCosts: number
): InclusivePricingResult {
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const goodsTotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const targetTotal = round2(goodsTotal + additionalCosts);

  // Nothing to spread: the goods prices stand as they are.
  if (additionalCosts === 0 || totalQuantity === 0) {
    const lines = items.map((item) => ({
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      amount: round2(item.unitPrice * item.quantity),
      decimals: 2,
    }));
    return {
      lines,
      total: round2(lines.reduce((sum, line) => sum + line.amount, 0)),
      perUnitCost: 0,
      decimals: 2,
      reconciled: true,
      remainder: 0,
    };
  }

  const perUnitCost = additionalCosts / totalQuantity;

  /** Apportion and price every line at the given precision. */
  const priceAt = (decimals: number): { lines: OutputLine[]; total: number } => {
    const roundedPerUnit = roundN(perUnitCost, decimals);
    const lines = items.map((item) => {
      // The unit price returned is the one the amount was computed from, so
      // quantity x unitPrice == amount always holds.
      const unitPrice = roundN(item.unitPrice + roundedPerUnit, decimals);
      return {
        unitPrice,
        quantity: item.quantity,
        amount: round2(unitPrice * item.quantity),
        decimals,
      };
    });
    return {
      lines,
      total: round2(lines.reduce((sum, line) => sum + line.amount, 0)),
    };
  };

  let result = priceAt(2);
  for (const decimals of [3, 4, 5, 6]) {
    if (Math.abs(result.total - targetTotal) < 0.005) break;
    const next = priceAt(decimals);
    // Keep the closer of the two: more decimals is not always nearer the target.
    if (Math.abs(next.total - targetTotal) < Math.abs(result.total - targetTotal)) {
      result = next;
    }
  }

  const remainder = round2(targetTotal - result.total);

  return {
    lines: result.lines,
    total: result.total,
    perUnitCost,
    decimals: result.lines[0]?.decimals ?? 2,
    reconciled: Math.abs(remainder) < 0.005,
    remainder,
  };
}
