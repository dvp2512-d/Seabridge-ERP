/**
 * Quotation pricing engine.
 *
 * A line item's price is built up from a stack of components:
 *
 *   1. Product Price (Supplier)
 *   2. Packaging & Processing
 *   3. Our Margin
 *   4. CHA / Customs
 *   5. Local Transportation
 *   6. Transportation - Air / Sea / Road
 *   7. Insurance
 *   8. Inspection
 *   9. Other
 *
 *   Line total     = sum of every component amount
 *   Per unit price = line total / quantity
 *
 * Every component is charged onward to the buyer. This is deliberate: the
 * previous model added costs like CHA to "cost" without raising the sell price,
 * which silently reduced margin instead of recovering the expense.
 *
 * This module is the single source of truth. The browser computes the same
 * numbers for a live preview, but whatever it sends is always recalculated here
 * before anything is stored.
 */

export type PricingCalcType = 'FIXED' | 'PER_UNIT' | 'PERCENT_OF_COST';

export interface PricingComponentInput {
  parameterId?: string | null;
  name: string;
  calcType: PricingCalcType;
  isMargin?: boolean;
  sortOrder?: number;
  /** What the user typed: a lump sum, a per-unit rate, or a percentage. */
  value: number;
}

export interface PricingComponentResult extends PricingComponentInput {
  isMargin: boolean;
  sortOrder: number;
  /** What this component contributed to the line total. */
  amount: number;
}

export interface LinePricingResult {
  components: PricingComponentResult[];
  /** Sum of every component - what the buyer pays for this line. */
  totalPrice: number;
  /** Sum of non-margin components. */
  totalCost: number;
  /** Sum of margin components. */
  margin: number;
  /** Margin as a share of the sell price. */
  marginPercent: number;
  /** totalPrice / quantity - the headline per-unit figure. */
  unitPrice: number;
  /** totalCost / quantity. */
  unitCost: number;
}

/** Round to 2dp for money, guarding against NaN/Infinity reaching the database. */
function money(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Round to 2dp for percentages. */
function percent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Price a single line item from its components.
 *
 * PERCENT_OF_COST is applied to the sum of all non-margin, non-percentage
 * components. Percentages therefore never compound with each other, so the
 * order in which the user arranges them cannot change the result.
 */
export function calculateLinePricing(
  quantity: number,
  components: PricingComponentInput[]
): LinePricingResult {
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;

  // Pass 1: everything with a directly computable amount.
  const base = components.map((component, index) => {
    const value = Number.isFinite(component.value) ? component.value : 0;
    const isMargin = component.isMargin ?? false;
    const sortOrder = component.sortOrder ?? index;

    let amount: number | null;
    switch (component.calcType) {
      case 'FIXED':
        amount = value;
        break;
      case 'PER_UNIT':
        amount = value * qty;
        break;
      case 'PERCENT_OF_COST':
        amount = null; // needs the cost base from pass 1
        break;
      default:
        amount = value;
    }

    return { ...component, isMargin, sortOrder, amount };
  });

  // The base that percentages apply to: absolute cost components only.
  const costBase = base
    .filter((c) => !c.isMargin && c.amount !== null)
    .reduce((sum, c) => sum + (c.amount as number), 0);

  // Pass 2: resolve percentages.
  const resolved: PricingComponentResult[] = base.map((c) => ({
    ...c,
    amount: money(c.amount === null ? (costBase * c.value) / 100 : c.amount),
  }));

  const totalCost = money(
    resolved.filter((c) => !c.isMargin).reduce((sum, c) => sum + c.amount, 0)
  );
  const margin = money(
    resolved.filter((c) => c.isMargin).reduce((sum, c) => sum + c.amount, 0)
  );
  const totalPrice = money(totalCost + margin);

  return {
    components: resolved,
    totalPrice,
    totalCost,
    margin,
    marginPercent: totalPrice > 0 ? percent((margin / totalPrice) * 100) : 0,
    unitPrice: qty > 0 ? money(totalPrice / qty) : 0,
    unitCost: qty > 0 ? money(totalCost / qty) : 0,
  };
}

export interface QuotationTotals {
  subtotal: number;
  totalCost: number;
  totalMargin: number;
  marginPercent: number;
  grandTotal: number;
}

/** Roll priced lines up into the quotation totals. */
export function calculateQuotationTotals(
  lines: Pick<LinePricingResult, 'totalPrice' | 'totalCost' | 'margin'>[]
): QuotationTotals {
  const subtotal = money(lines.reduce((sum, l) => sum + l.totalPrice, 0));
  const totalCost = money(lines.reduce((sum, l) => sum + l.totalCost, 0));
  const totalMargin = money(lines.reduce((sum, l) => sum + l.margin, 0));

  return {
    subtotal,
    totalCost,
    totalMargin,
    marginPercent: subtotal > 0 ? percent((totalMargin / subtotal) * 100) : 0,
    // Everything is already inside the line prices, so there is nothing further
    // to add here. Adding costs again at this level is what double-charged.
    grandTotal: subtotal,
  };
}
