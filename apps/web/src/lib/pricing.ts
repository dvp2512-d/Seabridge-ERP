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

export type PricingCalcType = 'FIXED' | 'PER_UNIT' | 'PERCENT_OF_COST';

export interface PricingComponent {
  /** Stable key for React lists (client-side only). */
  key: string;
  parameterId?: string | null;
  name: string;
  calcType: PricingCalcType;
  isMargin: boolean;
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
 * PERCENT_OF_COST applies to the sum of the absolute (non-percentage) cost
 * components, so percentages never compound and reordering cannot change totals.
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
        amount = null;
        break;
      default:
        amount = value;
    }

    return { component, value, amount };
  });

  const costBase = base
    .filter((b) => !b.component.isMargin && b.amount !== null)
    .reduce((sum, b) => sum + (b.amount as number), 0);

  const priced: PricedComponent[] = base.map((b) => ({
    ...b.component,
    amount: money(b.amount === null ? (costBase * b.value) / 100 : b.amount),
  }));

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
    case 'PERCENT_OF_COST':
      return '% of the total cost components';
    default:
      return '';
  }
}

export const CALC_TYPE_OPTIONS: { value: PricingCalcType; label: string }[] = [
  { value: 'FIXED', label: 'Fixed amount' },
  { value: 'PER_UNIT', label: 'Per unit' },
  { value: 'PERCENT_OF_COST', label: '% of cost' },
];
