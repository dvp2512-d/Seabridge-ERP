/**
 * How goods are packed.
 *
 * Used in three places that must agree: the product's default packaging, the package
 * type on an order line, and the "Total Cartons / Box" and "No. of Packages" figures
 * printed on the packing list and the invoices. The list was previously hardcoded
 * inside the Products form, so the order-line selector would have been a second copy
 * of it.
 *
 * Mirrored in apps/web/src/lib/packageTypes.ts, for the same reason invoiceTypes is:
 * the API validates, the UI labels, and only the values have to stay in step.
 */

export const PACKAGE_TYPES = [
  'BAG',
  'CARTON',
  'BOX',
  'DRUM',
  'JUMBO_BAG',
  'PALLET',
  'SACK',
  'CRATE',
] as const;

export type PackageType = (typeof PACKAGE_TYPES)[number];

/**
 * How a type is printed on a document, singular and plural.
 *
 * Plural matters: "110 BAGS" reads as a quantity, "110 BAG" reads as a typo on a
 * document a customs officer is checking.
 */
const PLURALS: Record<string, string> = {
  BAG: 'BAGS',
  CARTON: 'CARTONS',
  BOX: 'BOXES',
  DRUM: 'DRUMS',
  JUMBO_BAG: 'JUMBO BAGS',
  PALLET: 'PALLETS',
  SACK: 'SACKS',
  CRATE: 'CRATES',
};

/** "BAG" -> "JUMBO BAG"; unknown values are passed through, underscores removed. */
export function packageTypeLabel(type: string | null | undefined): string {
  if (!type) return '';
  return String(type).toUpperCase().replace(/_/g, ' ');
}

/** "40 BAGS", or "1 BAG". Empty when the type is not set. */
export function packageCountText(count: number, type: string | null | undefined): string {
  if (!type) return String(count);
  const upper = String(type).toUpperCase();
  const word = count === 1 ? packageTypeLabel(upper) : (PLURALS[upper] ?? `${packageTypeLabel(upper)}S`);
  return `${count} ${word}`;
}
