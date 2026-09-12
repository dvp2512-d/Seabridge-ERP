/**
 * Purchase order pricing.
 *
 * A purchase order total is rate x quantity per line, plus GST:
 *
 *   line taxable = rate x quantity
 *   line tax     = taxable x taxPercent / 100
 *   subtotal     = sum of the taxable values
 *   taxAmount    = sum of the line taxes
 *   totalAmount  = subtotal + taxAmount
 *
 * WHY THE TOTAL IS NEVER ACCEPTED FROM THE CLIENT
 *   It used to be typed straight into `procurements.total_amount`, independently of
 *   anything else, which is how the printed order ended up showing an item column
 *   that summed to one figure and a TOTAL box showing another. Computing it here on
 *   every write means the two cannot disagree, and it removes the arithmetic from
 *   the operator's hands - a supplier payable is not a place for mental maths.
 *
 * WHY TAX IS SUMMED PER LINE RATHER THAN APPLIED TO THE SUBTOTAL
 *   Products carry different GST rates. Psyllium husk and the packaging it ships in
 *   are not taxed alike, so one rate over the whole order would be wrong whenever an
 *   order mixes them. Rounding each line to the paisa and summing also matches how a
 *   supplier's own tax invoice will be computed, which is what the figures get
 *   reconciled against.
 *
 * WHY AN UNKNOWN RATE IS NOT ZERO
 *   A null taxPercent contributes no tax and is reported as unknown. Treating it as
 *   zero would produce a total that looks complete and understates what the supplier
 *   will invoice.
 */

export interface ProcurementLineInput {
  productId: string;
  quantity: number;
  unit?: string;
  /** Supplier's price per unit, in INR. */
  rate: number;
  /** GST percent. Null or undefined means not yet known. */
  taxPercent?: number | null;
  notes?: string | null;
}

export interface PricedProcurementLine {
  productId: string;
  quantity: number;
  unit: string;
  rate: number;
  taxPercent: number | null;
  /** rate x quantity, to two decimals. */
  amount: number;
  /** GST on this line, to two decimals. */
  taxAmount: number;
  notes: string | null;
}

export interface ProcurementTotals {
  lines: PricedProcurementLine[];
  /** Taxable value: the sum of the line amounts. */
  subtotal: number;
  /** GST across the order. */
  taxAmount: number;
  /** What the supplier will be paid. */
  totalAmount: number;
  /** Lines with no tax rate on file, so the caller can say so rather than imply zero. */
  linesWithoutTax: number;
}

function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** A finite, non-negative number, or 0. */
function safe(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Price a set of purchase order lines and total them.
 *
 * Pure: no database access, so the same arithmetic can be used when saving an order
 * and when previewing one that has not been saved yet.
 */
export function priceProcurementLines(inputs: ProcurementLineInput[]): ProcurementTotals {
  const lines: PricedProcurementLine[] = inputs.map((input) => {
    const quantity = safe(input.quantity);
    const rate = safe(input.rate);
    const amount = round2(quantity * rate);

    // Null stays null: unknown is not the same as nil.
    const taxPercent =
      input.taxPercent === null || input.taxPercent === undefined
        ? null
        : safe(input.taxPercent);

    const taxAmount = taxPercent === null ? 0 : round2((amount * taxPercent) / 100);

    return {
      productId: input.productId,
      quantity,
      unit: input.unit || 'KG',
      rate,
      taxPercent,
      amount,
      taxAmount,
      notes: input.notes ?? null,
    };
  });

  const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const taxAmount = round2(lines.reduce((sum, l) => sum + l.taxAmount, 0));

  return {
    lines,
    subtotal,
    taxAmount,
    totalAmount: round2(subtotal + taxAmount),
    linesWithoutTax: lines.filter((l) => l.taxPercent === null).length,
  };
}
