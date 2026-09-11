/**
 * Whether each export document has everything it needs before it is sent.
 *
 * A document with an empty box is not obviously broken - it renders, downloads and
 * looks finished. The gap is discovered by whoever receives it: a bank rejecting an
 * LC presentation over a missing vessel name, or a customs officer holding a
 * consignment because the packing list shows no gross weight. By then the shipment
 * has sailed.
 *
 * So the same fields the renderer reads are checked here, and reported per document
 * before anyone generates one. The rules are deliberately kept in this file rather
 * than in the UI: they have to move together with services/pdfService.ts, and a
 * check that lives in a React component drifts from what actually prints.
 *
 * WHAT COUNTS AS REQUIRED
 *   Only fields whose absence a third party would reject or query. A missing note is
 *   not a problem; a missing net weight on a packing list is. Fields with a sensible
 *   fallback in the renderer - the exporter's name, the standard declarations - are
 *   not listed, because they are never blank on the page.
 */

/** One checked field on a document. */
export interface ReadinessField {
  /** As the box is captioned on the printed document, so the two can be matched. */
  label: string;
  ready: boolean;
  /** Where the value is entered, so a gap can be acted on rather than hunted for. */
  where: string;
}

export interface DocumentReadiness {
  /** Invoice type, or QUOTATION / PURCHASE_ORDER. */
  document: string;
  label: string;
  fields: ReadinessField[];
  readyCount: number;
  totalCount: number;
  /** True when nothing a recipient would query is missing. */
  complete: boolean;
}

/** A value counts as present when it is not null, undefined or an empty string. */
function has(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/**
 * The shipment strip, shared by every invoice-family document.
 *
 * The vessel is required because a bank presentation names the carrier, and the
 * ports because they are what the document is cleared against. Container number is
 * excluded: an LCL consignment legitimately has none.
 */
function shipmentFields(order: any): ReadinessField[] {
  const shipment = order?.shipments?.[0];
  return [
    {
      label: 'Mathod Of Dispatch',
      ready: has(order?.dispatchMethod) || has(shipment?.originPort?.type) || has(order?.portOfLoading?.type),
      where: 'Order \u2192 Document Details',
    },
    {
      label: 'Type Of Shipment',
      ready: has(order?.shipmentType) || has(shipment?.containerType),
      where: 'Order \u2192 Document Details',
    },
    {
      label: 'Port Of Loading',
      ready: has(shipment?.originPort?.name) || has(order?.portOfLoading?.name),
      where: 'Order \u2192 Document Details',
    },
    {
      label: 'Port Of Discharge',
      ready: has(shipment?.destinationPort?.name) || has(order?.portOfDischarge?.name),
      where: 'Order \u2192 Document Details',
    },
    {
      label: 'Vessel / Flight No',
      ready: has(shipment?.vesselName),
      where: 'Order \u2192 Shipments',
    },
  ];
}

/**
 * The weight block, printed on the commercial, proforma and sample invoices.
 *
 * Net weight has a fallback - a quantity in kilograms is a net weight - so it is
 * only missing when the goods are not sold by mass. Gross weight and the package
 * count have no fallback and are what a carrier weighs against.
 */
function weightFields(order: any): ReadinessField[] {
  const items: any[] = order?.items ?? [];
  const every = (pick: (i: any) => unknown) => items.length > 0 && items.every((i) => has(pick(i)));

  return [
    {
      label: 'Total Cartons / Box',
      ready: every((i) => i.numberOfPackages),
      where: 'Order \u2192 Items \u2192 Packing',
    },
    {
      label: 'Net Weight',
      ready: every((i) => i.netWeight) || items.every((i) => has(i.quantity)),
      where: 'Order \u2192 Items \u2192 Packing',
    },
    {
      label: 'Gross Weight',
      ready: every((i) => i.grossWeight),
      where: 'Order \u2192 Items \u2192 Packing',
    },
  ];
}

/** Bank details, which a buyer needs in order to pay. */
function bankFields(companyProfile: any): ReadinessField[] {
  return [
    {
      label: 'Bank Details',
      ready: has(companyProfile?.bankName) && has(companyProfile?.bankAccountNo),
      where: 'Settings \u2192 Company Profile',
    },
    {
      label: 'Swift Code',
      ready: has(companyProfile?.bankSwiftCode),
      where: 'Settings \u2192 Company Profile',
    },
  ];
}

/** Fields every document shares: the exporter's registrations and the consignee. */
function commonFields(order: any, companyProfile: any): ReadinessField[] {
  return [
    {
      label: 'IEC No',
      ready: has(companyProfile?.iecCode),
      where: 'Settings \u2192 Company Profile',
    },
    {
      label: 'Consignee',
      ready: has(order?.buyer?.companyName) && has(order?.buyer?.address),
      where: 'Buyers',
    },
    {
      label: 'Country of Final Destination',
      ready: has(order?.buyer?.country?.name),
      where: 'Buyers',
    },
    {
      label: 'Items',
      ready: (order?.items?.length ?? 0) > 0,
      where: 'Quotation',
    },
  ];
}

function summarise(document: string, label: string, fields: ReadinessField[]): DocumentReadiness {
  const readyCount = fields.filter((f) => f.ready).length;
  return {
    document,
    label,
    fields,
    readyCount,
    totalCount: fields.length,
    complete: readyCount === fields.length,
  };
}

/**
 * Readiness for every document that can be raised against an order.
 *
 * The invoice-family entries describe what a document of that type would contain if
 * generated now; they are not tied to an existing invoice record, because the point
 * is to know before creating one.
 */
export function assessOrderDocuments(order: any, companyProfile: any): DocumentReadiness[] {
  const common = commonFields(order, companyProfile);
  const shipment = shipmentFields(order);
  const weights = weightFields(order);
  const bank = bankFields(companyProfile);

  const commercial = summarise('COMMERCIAL', 'Commercial Invoice', [
    ...common,
    ...shipment,
    // Only the commercial invoice captions the container box.
    {
      label: 'Container No',
      ready: has(order?.shipments?.[0]?.containerNumber),
      where: 'Order \u2192 Shipments',
    },
    ...weights,
    ...bank,
    {
      label: 'Terms of Delivery and Payment',
      ready: has(order?.incoterm?.code) && has(order?.paymentTerms),
      where: 'Order \u2192 Document Details',
    },
  ]);

  const proforma = summarise('PROFORMA', 'Proforma Invoice', [
    ...common,
    ...shipment,
    ...weights,
    ...bank,
    {
      // A proforma states an intended quantity, so the tolerance is what makes it
      // usable for opening an LC.
      label: 'Variation % +/-',
      ready: has(order?.variationPercent),
      where: 'Order \u2192 Document Details',
    },
  ]);

  const sample = summarise('SAMPLE', 'Sample Invoice', [
    ...common,
    ...shipment,
    {
      label: 'HS Code',
      ready:
        (order?.items?.length ?? 0) > 0 &&
        order.items.every((i: any) => has(i.product?.hsnCode)),
      where: 'Products',
    },
    // The sample sheet states net and gross weight in its footer.
    ...weights.filter((f) => f.label !== 'Total Cartons / Box'),
  ]);

  const packingList = summarise('PACKING_LIST', 'Packing List', [
    ...common,
    ...shipment.filter((f) => f.label !== 'Vessel / Flight No'),
    {
      label: 'No. of Packages',
      ready: (order?.items?.length ?? 0) > 0 && order.items.every((i: any) => has(i.numberOfPackages)),
      where: 'Order \u2192 Items \u2192 Packing',
    },
    {
      label: 'Bag / Carton Per KGs',
      ready:
        (order?.items?.length ?? 0) > 0 &&
        order.items.every((i: any) => has(i.packageWeight) || has(i.product?.packageNetWeight)),
      where: 'Order \u2192 Items \u2192 Packing',
    },
    ...weights.filter((f) => f.label !== 'Total Cartons / Box'),
  ]);

  return [commercial, proforma, sample, packingList];
}
