/**
 * The five export documents, each mapped onto the shared frame in
 * exportDocumentService.ts. One function per sheet in MASTER DRAFT.xlsx:
 *
 *   QUOTE FORMATE      -> buildQuotationDocument
 *   Sample Invoice     -> buildSampleInvoiceDocument
 *   Proforma Invoice   -> buildProformaInvoiceDocument
 *   Packing List       -> buildPackingListDocument
 *   Commercial Invoice -> buildCommercialInvoiceDocument
 *
 * Each takes records already loaded with their relations and returns a PDF.
 */
import {
  generateExportDocument,
  amountInWords,
  money,
  qty,
  formatDate,
  num,
  type DocumentColumn,
  type FooterBlock,
} from './exportDocumentService';

/** Shipment-ish details, sourced from the order or its first shipment. */
interface DispatchInfo {
  dispatchMethod?: string | null;
  shipmentType?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  vesselOrFlight?: string | null;
}

function dispatchFrom(order: any): DispatchInfo {
  const shipment = order?.shipments?.[0];
  return {
    dispatchMethod: order?.dispatchMethod ?? null,
    shipmentType: order?.shipmentType ?? shipment?.containerType ?? null,
    portOfLoading: shipment?.originPort?.name ?? null,
    portOfDischarge: shipment?.destinationPort?.name ?? null,
    vesselOrFlight: shipment?.vesselName ?? shipment?.blNumber ?? null,
  };
}

/** Bank details block, printed on Proforma and Commercial invoices. */
function bankBlock(company: any): FooterBlock | null {
  if (!company?.bankName && !company?.bankAccountNo) return null;
  const lines = [
    company.bankName
      ? `Bank Name : ${company.bankName}${company.bankBranch ? ', ' + company.bankBranch : ''}`
      : null,
    company.bankAccountNo ? `Account No : ${company.bankAccountNo}` : null,
    company.bankBeneficiary ? `Beneficiary Name : ${company.bankBeneficiary}` : null,
    company.bankSwiftCode ? `Swift Code : ${company.bankSwiftCode}` : null,
    company.bankIfscCode ? `IFSC Code : ${company.bankIfscCode}` : null,
    company.bankChargesNote,
  ].filter(Boolean);
  return { title: 'Bank Details:', body: lines.join('\n') };
}

/** Cartons / net / gross / variation summary used by several documents. */
function packingSummary(items: any[], variationPercent?: unknown): string | null {
  const packages = items.reduce((s, i) => s + num(i.numberOfPackages), 0);
  const net = items.reduce((s, i) => s + num(i.netWeight), 0);
  const gross = items.reduce((s, i) => s + num(i.grossWeight), 0);

  // Nothing recorded yet - omit rather than print a row of zeros.
  if (packages === 0 && net === 0 && gross === 0) return null;

  const parts = [
    packages ? `Total Cartons / Box : ${qty(packages)}` : null,
    net ? `Net Weight : ${qty(net)} KGS` : null,
    gross ? `Gross Weight : ${qty(gross)} KGS` : null,
    num(variationPercent) ? `Variation % +/- : ${qty(variationPercent)} %` : null,
  ].filter(Boolean);
  return parts.join('          ');
}

// ---------------------------------------------------------------- Quotation

export function buildQuotationDocument(quotation: any, company: any) {
  const currency = quotation.currency?.code ?? 'USD';
  const additional = (quotation.costs ?? []).reduce((s: number, c: any) => s + num(c.amount), 0);

  const columns: DocumentColumn[] = [
    { header: 'Product Code', width: 0.13, value: (i) => i.product?.hsnCode ?? i.product?.code ?? '-' },
    { header: 'Description of Goods', width: 0.4, value: (i) => i.product?.name ?? '-' },
    { header: 'QTY', width: 0.1, align: 'right', value: (i) => qty(i.quantity) },
    { header: 'Unit Type', width: 0.1, align: 'center', value: (i) => i.unit ?? 'KG' },
    { header: `Price (${currency})`, width: 0.12, align: 'right', value: (i) => money(i.unitPrice) },
    { header: 'Amount', width: 0.15, align: 'right', value: (i) => money(i.totalPrice) },
  ];

  const totals: [string, string][] = [];
  if (additional > 0) {
    totals.push(['SUBTOTAL', `${currency} ${money(quotation.subtotal)}`]);
    totals.push(['ADDITIONAL CHARGES', `${currency} ${money(additional)}`]);
  }
  totals.push(['TOTAL', `${currency} ${money(quotation.grandTotal)}`]);

  const footerBlocks: FooterBlock[] = [];
  if (company?.quotationTerms) {
    footerBlocks.push({
      title: 'Terms & Conditions:',
      body: String(company.quotationTerms)
        .split('\n')
        .map((line: string) => `• ${line.trim()}`)
        .join('\n'),
    });
  }
  if (quotation.paymentTerms || quotation.deliveryTerms) {
    footerBlocks.push({
      body: [
        quotation.paymentTerms ? `Payment Terms : ${quotation.paymentTerms}` : null,
        quotation.deliveryTerms ? `Delivery Terms : ${quotation.deliveryTerms}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }
  if (quotation.notes) footerBlocks.push({ title: 'Notes:', body: quotation.notes });

  return generateExportDocument({
    title: 'Quotation',
    company,
    buyer: quotation.buyer,
    references: [
      { label: 'Quotation No', value: quotation.quotationNumber ?? '-' },
      { label: 'Date', value: formatDate(quotation.createdAt) },
      { label: 'Valid Until', value: formatDate(quotation.validUntil) },
      { label: 'Terms / Method Of Payment', value: quotation.paymentTerms ?? '-' },
    ],
    originCountry: company?.originCountry ?? 'India',
    dispatchMethod: null,
    shipmentType: null,
    portOfLoading: null,
    portOfDischarge: null,
    vesselOrFlight: quotation.incoterm?.code ? `Incoterm : ${quotation.incoterm.code}` : null,
    columns,
    items: quotation.items ?? [],
    totals,
    amountInWordsLine: amountInWords(num(quotation.grandTotal), currency),
    footerBlocks,
  });
}

// ---------------------------------------------------------------- shared invoice frame

function invoiceColumns(currency: string, rateHeader: string): DocumentColumn[] {
  return [
    { header: 'HS Code', width: 0.13, value: (i) => i.product?.hsnCode ?? i.product?.code ?? '-' },
    { header: 'Description of Goods', width: 0.4, value: (i) => i.product?.name ?? '-' },
    { header: 'Quantity', width: 0.1, align: 'right', value: (i) => qty(i.quantity) },
    { header: 'Unit Type', width: 0.1, align: 'center', value: (i) => i.unit ?? 'KG' },
    { header: `${rateHeader} (${currency})`, width: 0.12, align: 'right', value: (i) => money(i.unitPrice) },
    { header: 'Amount', width: 0.15, align: 'right', value: (i) => money(i.totalPrice) },
  ];
}

function invoiceReferences(invoice: any, order: any) {
  return [
    { label: 'Invoice No', value: invoice.invoiceNumber ?? '-' },
    { label: 'Date', value: formatDate(invoice.invoiceDate) },
    { label: "Buyer's Order No", value: order?.poNumber ?? order?.orderNumber ?? '-' },
    { label: 'Order Date', value: formatDate(order?.orderDate) },
  ];
}

// ---------------------------------------------------------------- Commercial Invoice

export function buildCommercialInvoiceDocument(invoice: any, company: any) {
  const currency = invoice.currency?.code ?? 'USD';
  const order = invoice.order;
  const items = order?.items ?? [];

  const totals: [string, string][] = [];
  if (num(invoice.taxAmount) > 0) {
    totals.push(['SUBTOTAL', `${currency} ${money(invoice.subtotal)}`]);
    totals.push(['TAX', `${currency} ${money(invoice.taxAmount)}`]);
  }
  totals.push(['TOTAL', `${currency} ${money(invoice.totalAmount)}`]);

  const footerBlocks: FooterBlock[] = [];
  const bank = bankBlock(company);
  if (bank) footerBlocks.push(bank);
  const terms = invoice.termsConditions ?? order?.paymentTerms;
  if (terms) {
    footerBlocks.push({ title: 'Terms / Method Of Payment:', body: terms });
  }

  return generateExportDocument({
    title: 'Commercial Invoice',
    company,
    buyer: invoice.buyer,
    references: invoiceReferences(invoice, order),
    originCountry: company?.originCountry ?? 'India',
    ...dispatchFrom(order),
    columns: invoiceColumns(currency, 'Rate'),
    items,
    totals,
    amountInWordsLine: amountInWords(num(invoice.totalAmount), currency),
    summaryLine: packingSummary(items, order?.variationPercent),
    footerBlocks,
    declaration: company?.invoiceDeclaration ?? null,
  });
}

// ---------------------------------------------------------------- Proforma Invoice

export function buildProformaInvoiceDocument(invoice: any, company: any) {
  const currency = invoice.currency?.code ?? 'USD';
  const order = invoice.order;
  const items = order?.items ?? [];

  const footerBlocks: FooterBlock[] = [];
  const bank = bankBlock(company);
  if (bank) footerBlocks.push(bank);
  // A proforma is what the buyer pays against, so the terms must always show.
  // Fall back to the order's terms when the invoice carries none of its own.
  const terms = invoice.termsConditions ?? order?.paymentTerms;
  if (terms) {
    footerBlocks.push({ title: 'Terms & Conditions:', body: terms });
  }
  if (order?.deliveryTerms) {
    footerBlocks.push({ body: `Delivery Terms : ${order.deliveryTerms}` });
  }

  return generateExportDocument({
    title: 'Proforma Invoice',
    company,
    buyer: invoice.buyer,
    references: invoiceReferences(invoice, order),
    originCountry: company?.originCountry ?? 'India',
    ...dispatchFrom(order),
    columns: invoiceColumns(currency, 'Rate'),
    items,
    totals: [['TOTAL', `${currency} ${money(invoice.totalAmount)}`]],
    amountInWordsLine: amountInWords(num(invoice.totalAmount), currency),
    summaryLine: packingSummary(items, order?.variationPercent),
    footerBlocks,
    declaration: company?.invoiceDeclaration ?? null,
  });
}

// ---------------------------------------------------------------- Sample Invoice

export function buildSampleInvoiceDocument(invoice: any, company: any) {
  const currency = invoice.currency?.code ?? 'USD';
  const order = invoice.order;
  const items = order?.items ?? [];

  return generateExportDocument({
    title: 'Sample Invoice',
    company,
    buyer: invoice.buyer,
    references: invoiceReferences(invoice, order),
    originCountry: company?.originCountry ?? 'India',
    ...dispatchFrom(order),
    columns: invoiceColumns(currency, 'Unit Rate'),
    items,
    totals: [['TOTAL', `${currency} ${money(invoice.totalAmount)}`]],
    amountInWordsLine: amountInWords(num(invoice.totalAmount), currency),
    // Samples carry no commercial value, so the declaration is mandatory.
    banner: 'NOT FOR SALE - SAMPLE ONLY, VALUE FOR CUSTOMS PURPOSES ONLY',
    summaryLine: packingSummary(items),
    footerBlocks: [
      { body: 'The goods are non-hazardous and comply with export regulations.' },
    ],
    declaration: company?.invoiceDeclaration ?? null,
  });
}

// ---------------------------------------------------------------- Packing List

export function buildPackingListDocument(order: any, company: any) {
  const items = order?.items ?? [];

  const columns: DocumentColumn[] = [
    { header: 'Product Code', width: 0.13, value: (i) => i.product?.hsnCode ?? i.product?.code ?? '-' },
    { header: 'Description of Goods', width: 0.37, value: (i) => i.product?.name ?? '-' },
    {
      header: 'No. of Packages',
      width: 0.12,
      align: 'right',
      value: (i) => (i.numberOfPackages ? qty(i.numberOfPackages) : '-'),
    },
    {
      header: 'Bag / Carton Per KGs',
      width: 0.13,
      align: 'right',
      value: (i) => (i.packageWeight ? qty(i.packageWeight) : '-'),
    },
    {
      header: 'Net Weight',
      width: 0.125,
      align: 'right',
      // Fall back to packages x per-package weight, as the sheet's formula does.
      value: (i) =>
        i.netWeight
          ? qty(i.netWeight)
          : num(i.numberOfPackages) && num(i.packageWeight)
          ? qty(num(i.numberOfPackages) * num(i.packageWeight))
          : '-',
    },
    {
      header: 'Gross Weight',
      width: 0.125,
      align: 'right',
      value: (i) => (i.grossWeight ? qty(i.grossWeight) : '-'),
    },
  ];

  const totalNet = items.reduce(
    (s: number, i: any) =>
      s + (num(i.netWeight) || num(i.numberOfPackages) * num(i.packageWeight)),
    0
  );
  const totalGross = items.reduce((s: number, i: any) => s + num(i.grossWeight), 0);
  const totalPackages = items.reduce((s: number, i: any) => s + num(i.numberOfPackages), 0);

  return generateExportDocument({
    title: 'Packing List',
    company,
    buyer: order.buyer,
    references: [
      { label: 'Packing List No', value: order.orderNumber ?? '-' },
      { label: 'Date', value: formatDate(order.orderDate) },
      { label: "Buyer's Order No", value: order.poNumber ?? '-' },
      { label: 'Invoice No', value: order.invoices?.[0]?.invoiceNumber ?? '-' },
    ],
    originCountry: company?.originCountry ?? 'India',
    ...dispatchFrom(order),
    columns,
    items,
    totals: [
      ['TOTAL PACKAGES', qty(totalPackages)],
      ['TOTAL NET WEIGHT (KGS)', qty(totalNet)],
      ['TOTAL GROSS WEIGHT (KGS)', qty(totalGross)],
    ],
    summaryLine: packingSummary(items, order.variationPercent),
    footerBlocks: [{ body: 'NON-HAZARDOUS GOODS' }],
  });
}
