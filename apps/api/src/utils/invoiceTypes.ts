/**
 * Invoice types and the one rule that matters about them: whether money is owed.
 *
 * `Invoice.type` is a plain string column rather than a Prisma enum, so this module
 * is the single place the permitted values and their meaning are defined. Every
 * receivable query and the payment guard derive from DOCUMENT_ONLY_INVOICE_TYPES
 * instead of naming types individually - when this list grows, the money figures
 * follow automatically rather than silently counting a new document as revenue.
 */

export const INVOICE_TYPES = ['EXPORT', 'PROFORMA', 'SAMPLE'] as const;

export type InvoiceType = (typeof INVOICE_TYPES)[number];

/**
 * Types issued for documentation only. No payment is accepted against them and
 * they are excluded from every receivable, overdue and collection figure.
 *
 * - PROFORMA: sent so the buyer can open an LC or arrange remittance. It states an
 *   intended price; nothing is owed until the commercial invoice is raised.
 * - SAMPLE: accompanies sample shipments through customs. The declared value exists
 *   for assessment purposes only - the goods are supplied free of charge, so
 *   treating that value as a receivable would invent revenue that will never arrive.
 */
export const DOCUMENT_ONLY_INVOICE_TYPES = ['PROFORMA', 'SAMPLE'] as const;

/** Types that represent a genuine demand for payment. */
export const COMMERCIAL_INVOICE_TYPES = INVOICE_TYPES.filter(
  (t) => !DOCUMENT_ONLY_INVOICE_TYPES.includes(t as any)
);

/**
 * Spread into a Prisma `type` filter to keep documents out of money totals.
 *
 * Deliberately a mutable `string[]` and not `as const`: Prisma's generated
 * `StringFilter.notIn` is `string[]`, and a readonly tuple is not assignable to it.
 * Marking it const also degrades inference on the surrounding aggregate, which
 * surfaces as unrelated "_sum is possibly undefined" errors.
 */
export const COMMERCIAL_TYPE_FILTER: { notIn: string[] } = {
  notIn: [...DOCUMENT_ONLY_INVOICE_TYPES],
};

/**
 * Do NOT interpolate a comma-joined string into a `prisma.$queryRaw` tagged
 * template - it would be bound as one parameter, so `type NOT IN ($1)` would
 * compare against the literal string "'PROFORMA', 'SAMPLE'", match nothing, and
 * silently let documents back into the money figures. Use `Prisma.join` on this
 * array instead, which binds one parameter per value.
 */
export const DOCUMENT_ONLY_TYPE_LIST: string[] = [...DOCUMENT_ONLY_INVOICE_TYPES];

export function isDocumentOnlyInvoice(type: string | null | undefined): boolean {
  return DOCUMENT_ONLY_INVOICE_TYPES.includes(type as any);
}

export const INVOICE_TYPE_LABELS: Record<string, string> = {
  EXPORT: 'Export Invoice',
  PROFORMA: 'Proforma Invoice',
  SAMPLE: 'Sample Invoice',
};

/** Heading printed at the top of the PDF. */
export const INVOICE_TYPE_DOCUMENT_TITLES: Record<string, string> = {
  EXPORT: 'INVOICE',
  PROFORMA: 'PROFORMA INVOICE',
  SAMPLE: 'SAMPLE INVOICE',
};

/**
 * Printed under the totals on document-only invoices so the reader - buyer or
 * customs officer - is not left to infer that no payment is due.
 */
export const INVOICE_TYPE_DECLARATIONS: Record<string, string> = {
  PROFORMA:
    'This is a proforma invoice issued for documentation purposes. It is not a demand for payment.',
  SAMPLE:
    'Sample shipment supplied free of charge. Value declared for customs purposes only.',
};
