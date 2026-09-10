/**
 * Invoice types, mirrored from apps/api/src/utils/invoiceTypes.ts.
 *
 * Kept as a small duplicate rather than a shared package because the two sides need
 * different things: the API needs Prisma filters, the UI needs labels and badge
 * colours. The one rule that must stay in step is which types are document-only -
 * if these lists diverge, a screen will offer to record a payment the API refuses.
 */

export const INVOICE_TYPES = ['EXPORT', 'PROFORMA', 'SAMPLE'] as const;

export type InvoiceType = (typeof INVOICE_TYPES)[number];

/** Issued for documentation only: no payment accepted, never a receivable. */
export const DOCUMENT_ONLY_INVOICE_TYPES: readonly string[] = ['PROFORMA', 'SAMPLE'];

export function isDocumentOnlyInvoice(type: string | null | undefined): boolean {
  return DOCUMENT_ONLY_INVOICE_TYPES.includes(type ?? '');
}

export const INVOICE_TYPE_LABELS: Record<string, string> = {
  EXPORT: 'Export Invoice',
  PROFORMA: 'Proforma Invoice',
  SAMPLE: 'Sample Invoice',
};

/** Compact form for table rows and badges, where the word "Invoice" is redundant. */
export const INVOICE_TYPE_SHORT_LABELS: Record<string, string> = {
  EXPORT: 'Export',
  PROFORMA: 'Proforma',
  SAMPLE: 'Sample',
};

/** Options for the Invoice Type dropdown. */
export const INVOICE_TYPE_OPTIONS = INVOICE_TYPES.map((value) => ({
  value,
  label: INVOICE_TYPE_LABELS[value],
}));

export const INVOICE_TYPE_BADGE_CLASS: Record<string, string> = {
  PROFORMA: 'badge-info',
  SAMPLE: 'badge-warning',
};

/** Why this document exists, shown where a user might expect to record a payment. */
export const INVOICE_TYPE_EXPLANATIONS: Record<string, string> = {
  PROFORMA:
    "This document is for the buyer's records - opening a letter of credit or arranging an advance. Raise the commercial invoice for this order and record the payment there.",
  SAMPLE:
    'This document accompanies a free sample shipment through customs. The value shown is declared for assessment only and is not payable.',
};

/**
 * "2 proformas and 1 sample" - used where a money figure has to explain what it
 * left out. Returns null when there is nothing to disclose.
 */
export function describeExcludedDocuments(
  countByType: Record<string, number> | undefined | null
): string | null {
  if (!countByType) return null;
  const parts = DOCUMENT_ONLY_INVOICE_TYPES.map((type) => {
    const n = countByType[type] ?? 0;
    if (n === 0) return null;
    const word = INVOICE_TYPE_SHORT_LABELS[type].toLowerCase();
    return `${n} ${word}${n > 1 ? 's' : ''}`;
  }).filter(Boolean) as string[];

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
