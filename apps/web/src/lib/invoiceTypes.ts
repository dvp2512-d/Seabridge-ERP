/**
 * Invoice types, mirrored from apps/api/src/utils/invoiceTypes.ts.
 *
 * Kept as a small duplicate rather than a shared package because the two sides need
 * different things: the API needs Prisma filters, the UI needs labels and badge
 * colours. The one rule that must stay in step is which types are document-only -
 * if these lists diverge, a screen will offer to record a payment the API refuses.
 */

/**
 * Exactly the invoice-family sheets in MASTER DRAFT.xlsx. There is no separate
 * "Export Invoice": on an Indian export shipment the commercial invoice is the
 * export invoice.
 */
export const INVOICE_TYPES = ['COMMERCIAL', 'PROFORMA', 'SAMPLE', 'PACKING_LIST'] as const;

export type InvoiceType = (typeof INVOICE_TYPES)[number];

/** Issued for documentation only: no payment accepted, never a receivable. */
export const DOCUMENT_ONLY_INVOICE_TYPES: readonly string[] = ['PROFORMA', 'SAMPLE', 'PACKING_LIST'];

export function isDocumentOnlyInvoice(type: string | null | undefined): boolean {
  return DOCUMENT_ONLY_INVOICE_TYPES.includes(type ?? '');
}

export const INVOICE_TYPE_LABELS: Record<string, string> = {
  COMMERCIAL: 'Commercial Invoice',
  PROFORMA: 'Proforma Invoice',
  SAMPLE: 'Sample Invoice',
  PACKING_LIST: 'Packing List',
};

/** Compact form for table rows and badges, where the word "Invoice" is redundant. */
export const INVOICE_TYPE_SHORT_LABELS: Record<string, string> = {
  COMMERCIAL: 'Commercial',
  PROFORMA: 'Proforma',
  SAMPLE: 'Sample',
  PACKING_LIST: 'Packing List',
};

/** Options for the Invoice Type dropdown. */
export const INVOICE_TYPE_OPTIONS = INVOICE_TYPES.map((value) => ({
  value,
  label: INVOICE_TYPE_LABELS[value],
}));

export const INVOICE_TYPE_BADGE_CLASS: Record<string, string> = {
  COMMERCIAL: 'badge-success',
  PROFORMA: 'badge-info',
  SAMPLE: 'badge-warning',
  PACKING_LIST: 'badge-gray',
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
