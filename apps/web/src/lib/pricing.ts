/**
 * Quotation pricing - browser copy, used only for the live preview while the
 * user types.
 *
 * This must stay numerically identical to apps/api/src/services/pricingService.ts,
 * which is authoritative. The server recalculates everything on save, so if the
 * two ever disagree the stored figures are the server's.
 *
 * scripts/verify-logic.ts asserts both implementations agree on a set of cases.
 */

export type PricingCalcType =
  | 'FIXED'
  | 'PER_UNIT'
  | 'PERCENT_OF_COST'
  | 'PERCENT_OF_PRODUCT';

export interface PricingComponent {
  /** Stable key for React lists (client-side only). */
  key: string;
  parameterId?: string | null;
  name: string;
  calcType: PricingCalcType;
  isMargin: boolean;
  /** Marks the product/supplier price - the base for PERCENT_OF_PRODUCT. */
  isProductPrice: boolean;
  sortOrder: number;
  /** Held as a string because it is bound to a text input. */
  value: string;
}

export interface PricedComponent extends PricingComponent {
  amount: number;
}

export interface LinePricing {
  components: PricedComponent[];
  totalPrice: number;
  totalCost: number;
  margin: number;
  marginPercent: number;
  unitPrice: number;
  unitCost: number;
}

function money(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function percent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function toNumber(value: string | number): number {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Price one line item.
 *
 * PERCENT_OF_PRODUCT applies to the product/supplier price only (this is what
 * margin uses). PERCENT_OF_COST applies to every cost component. Both bases are
 * built from the absolute components, so percentages never compound and
 * reordering rows cannot change the total.
 */
export function calculateLinePricing(
  quantity: string | number,
  components: PricingComponent[]
): LinePricing {
  const qtyRaw = toNumber(quantity);
  const qty = qtyRaw > 0 ? qtyRaw : 0;

  const base = components.map((component) => {
    const value = toNumber(component.value);
    let amount: number | null;

    switch (component.calcType) {
      case 'FIXED':
        amount = value;
        break;
      case 'PER_UNIT':
        amount = value * qty;
        break;
      case 'PERCENT_OF_COST':
      case 'PERCENT_OF_PRODUCT':
        amount = null;
        break;
      default:
        amount = value;
    }

    return { component, value, amount };
  });

  const absolute = base.filter((b) => b.amount !== null);

  const costBase = absolute
    .filter((b) => !b.component.isMargin)
    .reduce((sum, b) => sum + (b.amount as number), 0);

  const productBase = absolute
    .filter((b) => b.component.isProductPrice)
    .reduce((sum, b) => sum + (b.amount as number), 0);

  const priced: PricedComponent[] = base.map((b) => {
    if (b.amount !== null) return { ...b.component, amount: money(b.amount) };
    const basis =
      b.component.calcType === 'PERCENT_OF_PRODUCT' ? productBase : costBase;
    return { ...b.component, amount: money((basis * b.value) / 100) };
  });

  const totalCost = money(
    priced.filter((c) => !c.isMargin).reduce((sum, c) => sum + c.amount, 0)
  );
  const margin = money(
    priced.filter((c) => c.isMargin).reduce((sum, c) => sum + c.amount, 0)
  );
  const totalPrice = money(totalCost + margin);

  return {
    components: priced,
    totalPrice,
    totalCost,
    margin,
    marginPercent: totalPrice > 0 ? percent((margin / totalPrice) * 100) : 0,
    unitPrice: qty > 0 ? money(totalPrice / qty) : 0,
    unitCost: qty > 0 ? money(totalCost / qty) : 0,
  };
}

/** Human-readable explanation of how a component's amount was derived. */
export function describeCalcType(calcType: PricingCalcType): string {
  switch (calcType) {
    case 'FIXED':
      return 'Fixed amount for the whole line';
    case 'PER_UNIT':
      return 'Per unit, multiplied by quantity';
    case 'PERCENT_OF_PRODUCT':
      return '% of the product (supplier) price';
    case 'PERCENT_OF_COST':
      return '% of all cost components';
    default:
      return '';
  }
}

export const CALC_TYPE_OPTIONS: { value: PricingCalcType; label: string }[] = [
  { value: 'FIXED', label: 'Fixed amount' },
  { value: 'PER_UNIT', label: 'Per unit' },
  { value: 'PERCENT_OF_PRODUCT', label: '% of product price' },
  { value: 'PERCENT_OF_COST', label: '% of total cost' },
];
