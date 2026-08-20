/**
 * All-inclusive unit pricing.
 *
 * A quotation stores the goods price and the additional costs separately:
 * unitPrice is supplier price plus margin, and freight, CHA and the rest sit in
 * QuotationCost rows. The buyer, however, is quoted one figure per unit that
 * covers everything, and that is what the documents print and what the order
 * must carry.
 *
 *     unit price = supplier price + margin + (additional costs / total quantity)
 *
 * Costs are spread evenly per unit rather than by line value, because they are
 * overwhelmingly freight and handling, which follow weight and volume rather than
 * what the goods are worth. Loading them by value would inflate an expensive line
 * and under-recover on a cheap one.
 *
 * This lives in one place because it is used twice - once when printing a
 * quotation and once when converting it to an order - and the two drifting apart
 * is exactly the defect this replaces: the order used to carry goods-only line
 * prices while its total included the costs, so an order did not add up to
 * itself.
 */

export interface PricedLineInput {
  quantity: number | string;
  /** Goods price per unit: supplier price plus margin, excluding additional costs */
  unitPrice: number | string;
}

export interface PricedLine<T> {
  item: T;
  /** Quantity, as a number */
  quantity: number;
  /** All-inclusive price per unit */
  unitPrice: number;
  /** quantity x unitPrice, rounded to two decimals */
  amount: number;
  /** Decimal places used for unitPrice, so callers can print it consistently */
  decimals: number;
}

export interface PricingResult<T> {
  lines: PricedLine<T>[];
  /** Sum of the line amounts. Equals the target total when reconciliation worked. */
  total: number;
  /** Additional cost carried by each unit, before rounding */
  perUnitCost: number;
  decimals: number;
  /**
   * Difference between the quotation's grand total and the sum of the printed
   * line amounts, in currency units. Non-zero only when the per-unit cost cannot
   * be expressed exactly at any sensible precision.
   */
  remainder: number;
  /** True when remainder is nil, so the lines sum to the quoted grand total. */
  reconciled: boolean;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Spread additional costs across lines and return all-inclusive unit prices.
 *
 * Precision is chosen rather than fixed. Two decimals cannot always reconcile:
 * 40.00 of cost over 3 units is 13.333..., and 13.33 x 3 = 39.99, a paisa short.
 * So the smallest precision from two to six decimals that makes the amounts sum
 * to the true total is used, which is how export invoices handle it in practice.
 *
 * Very large quantities can defeat even six decimals - 137.77 spread over 25,000
 * units is 0.0055108 each, and no sensible unit price carries that exactly. In
 * that case the printed figures still agree with each other, which is what a
 * buyer or customs officer checks: qty x unit price = amount on every line, and
 * the amounts sum to the stated total. The stated total may then differ from the
 * quotation's grand total by a few paise, which `remainder` reports so the caller
 * can decide whether that matters. It is not treated as a failure, because
 * refusing to price the order would be worse than a rounding difference.
 */
export function calculateInclusiveUnitPrices<T extends PricedLineInput>(
  items: T[],
  additionalCosts: number
): PricingResult<T> {
  const totalQuantity = items.reduce((sum, i) => sum + num(i.quantity), 0);
  const goodsTotal = items.reduce((sum, i) => sum + num(i.unitPrice) * num(i.quantity), 0);
  const targetTotal = round2(goodsTotal + additionalCosts);

  // No quantity means nothing to spread across; return the goods prices as-is
  // rather than dividing by zero.
  const perUnitCost = totalQuantity > 0 ? additionalCosts / totalQuantity : 0;

  const priceAt = (decimals: number): { lines: PricedLine<T>[]; total: number } => {
    const factor = Math.pow(10, decimals);
    const lines = items.map((item) => {
      const quantity = num(item.quantity);
      const raw = num(item.unitPrice) + perUnitCost;
      const unitPrice = Math.round((raw + Number.EPSILON) * factor) / factor;
      return {
        item,
        quantity,
        unitPrice,
        amount: round2(unitPrice * quantity),
        decimals,
      };
    });
    const total = round2(lines.reduce((sum, l) => sum + l.amount, 0));
    return { lines, total };
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
    remainder,
    reconciled: Math.abs(remainder) < 0.005,
  };
}
