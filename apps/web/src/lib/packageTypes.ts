/**
 * Package types, mirrored from apps/api/src/utils/packageTypes.ts.
 *
 * A small duplicate rather than a shared package, matching how invoiceTypes is
 * handled: the API needs the values for validation, the UI needs readable labels for
 * a dropdown. Only the values have to stay in step.
 *
 * Used by the product's Default Packaging section and by the package type on an order
 * line, so the two selectors offer the same options.
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

export const PACKAGE_TYPE_LABELS: Record<string, string> = {
  BAG: 'Bag',
  CARTON: 'Carton',
  BOX: 'Box',
  DRUM: 'Drum',
  JUMBO_BAG: 'Jumbo Bag',
  PALLET: 'Pallet',
  SACK: 'Sack',
  CRATE: 'Crate',
};

/** Options for a package type dropdown. */
export const PACKAGE_TYPE_OPTIONS = PACKAGE_TYPES.map((value) => ({
  value,
  label: PACKAGE_TYPE_LABELS[value],
}));

/** "40 Bags" for a table cell. Falls back to the count alone when no type is set. */
export function packageCountLabel(
  count: number | null | undefined,
  type: string | null | undefined
): string {
  if (count === null || count === undefined) return '';
  if (!type) return String(count);
  const label = PACKAGE_TYPE_LABELS[type] ?? type;
  return `${count} ${count === 1 ? label : `${label}s`}`;
}
