/**
 * Inclusive Pricing Calculator
 *
 * Spreads additional costs (freight, insurance, CHA, etc.) evenly across line items
 * to produce "inclusive" unit prices that, when multiplied by quantity and summed,
 * equal the original goods total plus additional costs.
 *
 * This is useful for CIF/CFR quotations where the buyer sees one price per unit
 * that already includes all shipping costs.
 *
 * THE MATH:
 *   perUnitCost = additionalCosts / totalQuantity
 *   inclusiveUnitPrice = originalUnitPrice + perUnitCost
 *   lineAmount = inclusiveUnitPrice * quantity
 *   total = sum of all line amounts
 *
 * RECONCILIATION:
 *   Due to rounding, the calculated total may not exactly equal goodsTotal + additionalCosts.
 *   The algorithm tries increasing decimal precision (up to 6dp) to minimize the gap.
 *   If reconciliation is impossible, the remainder is reported.
 */

interface InputLine {
  quantity: number;
  unitPrice: number;
}

interface OutputLine {
  unitPrice: number;
  quantity: number;
  amount: number;
}

interface InclusivePricingResult {
  lines: OutputLine[];
  total: number;
  perUnitCost: number;
  reconciled: boolean;
  remainder: number;
}

/**
 * Round to 2 decimal places, handling floating-point edge cases.
 */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Round to N decimal places.
 */
function roundN(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Calculate inclusive unit prices by spreading additional costs evenly per unit.
 *
 * @param items - Array of line items with quantity and original unit price
 * @param additionalCosts - Total additional costs to spread (freight, insurance, etc.)
 * @returns Result with adjusted prices, totals, and reconciliation status
 */
export function calculateInclusiveUnitPrices(
  items: InputLine[],
  additionalCosts: number
): InclusivePricingResult {
  // Calculate totals
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const goodsTotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const targetTotal = round2(goodsTotal + additionalCosts);

  // If no additional costs, return original prices
  if (additionalCosts === 0 || totalQuantity === 0) {
    const lines = items.map((item) => ({
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      amount: round2(item.unitPrice * item.quantity),
    }));
    const total = lines.reduce((sum, line) => sum + line.amount, 0);
    return {
      lines,
      total: round2(total),
      perUnitCost: 0,
      reconciled: true,
      remainder: 0,
    };
  }

  // Calculate per-unit cost
  const perUnitCost = additionalCosts / totalQuantity;

  // Try different decimal precisions to find one that reconciles
  for (let decimals = 2; decimals <= 6; decimals++) {
    const roundedPerUnit = roundN(perUnitCost, decimals);

    const lines = items.map((item) => {
      const inclusivePrice = roundN(item.unitPrice + roundedPerUnit, decimals);
      const amount = round2(inclusivePrice * item.quantity);
      return {
        unitPrice: decimals === 2 ? round2(inclusivePrice) : inclusivePrice,
        quantity: item.quantity,
        amount,
      };
    });

    const total = round2(lines.reduce((sum, line) => sum + line.amount, 0));
    const remainder = round2(targetTotal - total);

    // Check if we've reconciled (within 0.01 tolerance)
    if (Math.abs(remainder) < 0.01) {
      return {
        lines: lines.map((line) => ({
          ...line,
          unitPrice: decimals === 2 ? line.unitPrice : round2(line.unitPrice),
        })),
        total,
        perUnitCost: round2(roundedPerUnit),
        reconciled: true,
        remainder: 0,
      };
    }
  }

  // If we couldn't reconcile, return the 2dp version with remainder reported
  const finalPerUnit = round2(perUnitCost);
  const lines = items.map((item) => {
    const inclusivePrice = round2(item.unitPrice + finalPerUnit);
    const amount = round2(inclusivePrice * item.quantity);
    return {
      unitPrice: inclusivePrice,
      quantity: item.quantity,
      amount,
    };
  });

  const total = round2(lines.reduce((sum, line) => sum + line.amount, 0));
  const remainder = round2(targetTotal - total);

  return {
    lines,
    total,
    perUnitCost: finalPerUnit,
    reconciled: false,
    remainder,
  };
}
