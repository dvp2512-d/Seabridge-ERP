/**
 * Export document rendering.
 *
 * Every document produced here follows MASTER DRAFT .xlsx: a ruled box grid where
 * each field occupies a captioned cell at a fixed position. See documentLayout.ts
 * for why the grid is the format rather than styling, and for the row primitives
 * these renderers are written in.
 *
 * The six documents in the master workbook map to the four functions below:
 *
 *   QUOTE FORMATE      -> generateQuotationPDF
 *   PO                 -> generatePurchaseOrderPDF
 *   Commercial Invoice -> generateInvoicePDF (type COMMERCIAL)
 *   Proforma Invoice   -> generateInvoicePDF (type PROFORMA)
 *   Sample Invoice     -> generateInvoicePDF (type SAMPLE)
 *   Packing List       -> generatePackingListPDF
 *
 * The invoice variants share one renderer because they share one grid; they differ
 * only in the title, the goods-code caption, which declarations print, and whether
 * bank details or a "NOT FOR SALE" stamp appear.
 *
 * CURRENCY: every stored amount is INR. A document is presented in the buyer's
 * currency at a rate the operator states when generating it, and both are recorded
 * on the document so a reprint reproduces what was sent. See
 * services/exchangeRateService.ts.
 */
import {
  INVOICE_TYPE_DOCUMENT_TITLES,
  isDocumentOnlyInvoice,
} from '../utils/invoiceTypes';
import PDFDocument from 'pdfkit';
import { calculateInclusiveUnitPrices } from './inclusivePricing';
import {
  LAYOUT,
  DOC_COLORS,
  amountInWords,
  bandRow,
  bannerRow,
  ensureRoom,
  splitRow,
  tableFiller,
  tableHeader,
  tableRow,
  type Cell,
  type Column,
} from './documentLayout';
import * as fs from 'fs';
import * as path from 'path';

type Doc = PDFKit.PDFDocument;

/**
 * Company logo. Checked in several places because the API runs both from source
 * in development and from dist/ inside the container, where the Dockerfile copies
 * apps/api/public.
 */
const LOGO_PATHS = [
  path.join(__dirname, '..', '..', 'public', 'logo.png'),
  path.join(__dirname, '..', '..', '..', '..', 'VL_BLUE 01.png'),
  path.join(process.cwd(), 'public', 'logo.png'),
  path.join(process.cwd(), 'VL_BLUE 01.png'),
];

function getLogoPath(): string | null {
  for (const p of LOGO_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Minimum number of item rows, so short documents keep the master's proportions. */
const MIN_ITEM_ROWS = 6;

/** Fallback when no CompanyProfile has been saved yet. */
const FALLBACK_EXPORTER = 'SEABRIDGE EXPORTS';

/**
 * Declarations printed on the documents.
 *
 * Kept here as named constants because they are legal statements the exporter is
 * making, not layout: they should be editable in one place, and a reviewer should
 * be able to read them without following the drawing code. The commercial wording
 * is overridden by CompanyProfile.invoiceDeclaration when one has been saved.
 */
const DECLARATIONS = {
  commercial:
    'We declare that this Invoice shows the actual Price of goods described and that all particulars are true and correct.',
  bankCharges: 'ALL BANKING CHARGES OUTSIDE INDIA ARE IN ACCOUNT OF APPLICANT',
  nonHazardous: 'The goods are non-hazardous and comply with export regulations.',
  nonHazardousStamp: 'NON-HAZARDOUS FOOD SAMPLE',
  notForSale: 'NOT FOR SALE',
  /**
   * Sample Invoice E7. Customs asks why a shipment with a declared value carries no
   * payment; this is the answer, stated in the header rather than left to the
   * declaration lower down. En dashes are as drafted.
   */
  samplePurpose: 'Free Sample \u2013 No Commercial Value \u2013 For Testing Only',
};

/** Distinct goods names on a document, as an English list. */
function goodsList(items: any[]): string {
  const names = Array.from(
    new Set(items.map((i) => i.product?.name).filter((n: unknown): n is string => Boolean(n)))
  );
  if (names.length === 0) return 'the goods listed above';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Purchase order terms, as the master PO sheet states them at A18:B20.
 *
 * The purchaser's own name appears in one clause, so this is a function rather
 * than a constant.
 */
const PO_TERMS = (purchaser: string): string[] => [
  '\u2022 This Purchase Order is issued subject to the supplier confirming the above quantity, rate, and delivery date in writing.',
  '\u2022 Goods must be accompanied by a batch-wise Certificate of Analysis (COA) at the time of delivery.',
  `\u2022 Any change in quantity, specification, or price must be approved in writing by ${purchaser} before dispatch.`,
  '\u2022 Supplier is responsible for quality and packaging until goods are received and inspected at the destination noted above.',
  '\u2022 Payment will be released as per the terms agreed above, subject to quality acceptance.',
  '\u2022 All disputes shall be subject to Ahmedabad (Gujarat) jurisdiction only.',
];

/**
 * Free-sample declaration, naming the goods actually being shipped.
 *
 * The master draft names psyllium husk and powder inline. Reading the names off
 * the items instead keeps the declaration true when a different sample ships - a
 * customs declaration that names the wrong goods is worse than a vague one.
 */
function sampleDeclaration(items: any[]): string {
  return (
    `We hereby declare that the above-mentioned goods are free samples of ${goodsList(items)}, ` +
    'supplied without any commercial value and intended only for laboratory testing ' +
    'and evaluation purposes.'
  );
}

/**
 * Packing list confirmation, as the master sheet words it, with the goods named
 * from the document rather than hardcoded to psyllium.
 *
 * The sheet's wording says the contents are samples of no commercial value, which
 * is true of the sample shipments this draft was written for. That clause is kept
 * only when the packing list accompanies a document-only invoice; on a packing
 * list for a commercial shipment it would contradict the invoice.
 */
function packingDeclaration(items: any[], documentOnly: boolean): string {
  const base =
    'We hereby confirm that the above packing list corresponds to the commercial ' +
    `invoice and contains ${goodsList(items)}`;

  return documentOnly
    ? `${base} samples intended only for testing purposes, with no commercial value.`
    : `${base} as described, packed as stated.`;
}

// ---------------------------------------------------------------------------
// Document plumbing
// ---------------------------------------------------------------------------

/**
 * Create a buffered document.
 *
 * Pages are buffered so the footer can be written after the fact, once the total
 * page count is known. An export document is checked page by page, so "Page 2 of 3"
 * is the difference between a complete document and a possibly truncated one.
 */
function createDocument(): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({ margin: 40, bufferPages: true, size: 'A4' });
  const chunks: Buffer[] = [];

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  return { doc, done };
}

/**
 * Write page numbers, and the conversion note when the document is not in INR,
 * then close the document.
 *
 * The bottom margin is temporarily removed for each write. Without this PDFKit
 * treats a write below the content area as overflow and appends a page, which
 * would then itself need a footer.
 */
function finalise(doc: Doc, note?: string): void {
  const range = doc.bufferedPageRange();

  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const savedMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const y = doc.page.height - 30;

    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(DOC_COLORS.muted)
      .text(`Page ${i - range.start + 1} of ${range.count}`, LAYOUT.left, y, {
        width: LAYOUT.width,
        align: 'right',
        lineBreak: false,
      });

    if (note && i === range.start) {
      doc.text(note, LAYOUT.left, y, { width: LAYOUT.width * 0.75, lineBreak: false });
    }

    doc.page.margins.bottom = savedMargin;
  }

  doc.end();
}

/**
 * A note stating the currency and rate the document was produced at.
 *
 * Amounts are held in INR, so a foreign-currency document is a conversion. Saying
 * so is what makes the figures auditable: without it a reader cannot reconcile the
 * document against the books.
 */
function conversionNote(code: string, rate: number): string | undefined {
  if (rate === 1) return undefined;
  return `Amounts shown in ${code}, converted at 1 ${code} = INR ${rate.toFixed(4)}.`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Money for a printed document, prefixed with the ISO currency code.
 *
 * The code is used rather than the symbol because PDFKit's built-in Helvetica has
 * no glyph for the rupee sign - it rendered as a stray superscript, so an INR
 * document read "¹1050.00". Naming the currency outright ("INR 1,050.00") is
 * standard on an export document and unambiguous for the buyer.
 *
 * `decimals` exists because an inclusive unit price may carry more than two
 * decimals. Printing such a price rounded to two would make the row fail the
 * buyer's own multiplication.
 */
function money(value: unknown, code: string, decimals = 2): string {
  const n = Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  return `${code} ${safe.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** A quantity, without trailing zeroes on whole numbers. */
function qtyText(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

/** Dates are spelled out; "11/09/2026" is read as two different days. */
function dateText(value: unknown): string {
  if (!value) return '';
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Convert an INR amount into the document currency. */
function fromINR(amountInINR: unknown, rate: number): number {
  const n = Number(amountInINR ?? 0);
  if (!Number.isFinite(n)) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return n;
  return n / rate;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundN(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * A unit rate and line amount that agree with each other.
 *
 * The first thing a buyer does with an invoice is multiply a row out. Converting
 * the stored INR unit price and the stored INR line total independently does not
 * survive that: INR 210.50/kg for 1,000 kg at 88.4215 gives a rate of USD 2.38064
 * and a line of USD 2,380.64, and printing the rate rounded to USD 2.38 makes the
 * row read 2.38 x 1000 = 2,380.64, which is wrong by 64 cents.
 *
 * So the smallest precision from two to six decimals that reproduces the true line
 * total is used, and the amount is derived from the rate at that precision. The row
 * then multiplies out exactly as printed. This is the same reconciliation
 * services/inclusivePricing.ts performs for a quotation, for the same reason.
 *
 * When no precision reconciles - which needs a quantity in the tens of thousands
 * against a fractional rate - the row is kept internally consistent at six
 * decimals and the line amount follows the printed rate. A row that fails the
 * buyer's calculator provokes a query; a cent of drift against the ledger does not.
 */
function reconcileLine(
  unitPrice: number,
  quantity: number
): { rate: number; decimals: number; amount: number } {
  const trueTotal = round2(unitPrice * quantity);

  for (const decimals of [2, 3, 4, 5, 6]) {
    const rate = roundN(unitPrice, decimals);
    const amount = round2(rate * quantity);
    if (Math.abs(amount - trueTotal) < 0.005) return { rate, decimals, amount };
  }

  const rate = roundN(unitPrice, 6);
  return { rate, decimals: 6, amount: round2(rate * quantity) };
}

// ---------------------------------------------------------------------------
// Shared field blocks
// ---------------------------------------------------------------------------

/**
 * The exporter block, as printed in A2:B4 of every master sheet.
 *
 * Which registration numbers appear differs by document, so it is a parameter:
 *  - the invoice sheets and the packing list show GST only, because the IEC number
 *    has its own cell in the header block (E4);
 *  - the quotation shows the IEC number only, written "IEC - ", and no GST;
 *  - the purchase order shows both, since it carries no separate IEC cell.
 */
function exporterLines(
  companyProfile: any,
  opts: { gst?: boolean; iec?: boolean; iecSeparator?: string } = { gst: true }
): string[] {
  const cityLine = [companyProfile?.city, companyProfile?.state, companyProfile?.postalCode]
    .filter(Boolean)
    .join(', ');
  const countryLine = [cityLine, (companyProfile?.country || 'INDIA').toUpperCase()]
    .filter(Boolean)
    .join(' - ');

  return [
    (companyProfile?.legalName || FALLBACK_EXPORTER).toUpperCase(),
    companyProfile?.addressLine1,
    companyProfile?.addressLine2,
    countryLine,
    opts.gst && companyProfile?.gstNumber ? `GST : ${companyProfile.gstNumber}` : null,
    opts.iec && companyProfile?.iecCode
      ? `IEC ${opts.iecSeparator ?? ':'} ${companyProfile.iecCode}`
      : null,
    [companyProfile?.phone, companyProfile?.contactPerson].filter(Boolean).join(' - '),
    companyProfile?.email,
  ].filter(Boolean) as string[];
}

/** A buyer or consignee address block. */
function partyLines(party: any): string[] {
  if (!party) return [];
  return [
    party.companyName,
    party.address,
    [party.city, party.state, party.postalCode].filter(Boolean).join(', '),
    party.country?.name,
    party.taxId && `Tax ID : ${party.taxId}`,
  ].filter(Boolean) as string[];
}

/** Supplier block for the purchase order. */
function supplierLines(supplier: any): string[] {
  if (!supplier) return [];
  // Supplier stores a single free-text `address`; there are no city/state columns.
  return [
    supplier.name,
    supplier.address,
    supplier.country?.name,
    supplier.gstNumber && `GST : ${supplier.gstNumber}`,
    supplier.contactPerson,
    supplier.phone,
    supplier.email,
  ].filter(Boolean) as string[];
}

/** Bank details, as printed in A19:B21 of the Commercial Invoice sheet. */
function bankLines(companyProfile: any): string[] {
  const lines = [
    companyProfile?.bankName && `Bank Name : ${companyProfile.bankName}`,
    companyProfile?.bankBranch && `Branch : ${companyProfile.bankBranch}`,
    companyProfile?.bankAccountNo && `Account No : ${companyProfile.bankAccountNo}`,
    (companyProfile?.bankBeneficiary || companyProfile?.legalName) &&
      `Beneficiary Name : ${companyProfile.bankBeneficiary || companyProfile.legalName}`,
    companyProfile?.bankSwiftCode && `Swift Code : ${companyProfile.bankSwiftCode}`,
    companyProfile?.bankIfscCode && `IFSC Code : ${companyProfile.bankIfscCode}`,
  ].filter(Boolean) as string[];

  lines.push('', companyProfile?.bankChargesNote || DECLARATIONS.bankCharges);
  return lines;
}

/**
 * Method of dispatch: the value carried on the order, else the type of the loading
 * port, which is the same information stated differently.
 *
 * This field used to print "AIR" on every document because it read a property that
 * does not exist on Shipment.
 */
function dispatchMethod(order: any, shipment: any): string {
  const declared = order?.dispatchMethod;
  if (declared) return String(declared).toUpperCase();

  const type = shipment?.originPort?.type ?? order?.portOfLoading?.type;
  if (type === 'AIR') return 'AIR';
  if (type === 'LAND') return 'ROAD';
  if (type === 'SEA') return 'SEA';
  return '';
}

/**
 * Type of shipment: the value carried on the order, else read off the container.
 *
 * LCL is a shared container; anything else named is a full container load. Blank
 * when neither is known, because at that point it is unknown.
 */
function shipmentType(order: any, shipment: any): string {
  const declared = order?.shipmentType;
  if (declared) return String(declared).toUpperCase();

  const containerType = shipment?.containerType;
  if (!containerType) return '';
  const upper = String(containerType).toUpperCase();
  return upper === 'LCL' ? 'LCL' : `FCL - ${upper}`;
}

// ---------------------------------------------------------------------------
// Weights and packing
// ---------------------------------------------------------------------------

/**
 * PACKING FIGURES ARE DECLARED, NOT DERIVED.
 *
 * A packing list wants four figures per line: number of packages, weight per
 * package, net weight and gross weight. `OrderItem` carries all four
 * (numberOfPackages, packageWeight, netWeight, grossWeight), added by migration
 * 20260816000000_export_documents for exactly these documents.
 *
 * Net weight falls back to the quantity when the goods are sold by mass, because
 * then the net weight of the goods IS the quantity, converted to kilograms - that
 * is a fact rather than an estimate. Nothing else is guessed. Gross weight depends
 * on the packaging used and the package count on how it was filled; neither can be
 * inferred from a quantity.
 *
 * These fields previously read `item.cartons` and `item.grossWeight` off a model
 * that declared neither, so every document printed a package count equal to its
 * line count and a gross weight exactly 10% above net. Those are declared figures
 * on a customs document and a carrier's weight certificate. Where a value has not
 * been entered the cell is left blank for the operator to complete, which is
 * visible, rather than filled with a plausible wrong number, which is not.
 */
const MASS_UNITS_IN_KG: Record<string, number> = {
  KG: 1,
  KGS: 1,
  MT: 1000,
  TON: 1000,
  TONS: 1000,
  TONNE: 1000,
  TONNES: 1000,
  G: 0.001,
  GM: 0.001,
  GRAM: 0.001,
  GRAMS: 0.001,
  LB: 0.45359237,
  LBS: 0.45359237,
};

/** A stored Decimal as a number, or null when it was never set. */
function decimalOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Net weight in kilograms: the entered figure, else the quantity if sold by mass. */
function netWeightKg(item: any): number | null {
  const declared = decimalOrNull(item?.netWeight);
  if (declared !== null) return declared;

  const unit = String(item?.unit ?? item?.product?.unit ?? '')
    .toUpperCase()
    .trim();
  const factor = MASS_UNITS_IN_KG[unit];
  if (factor === undefined) return null;

  const quantity = Number(item?.quantity ?? 0);
  return Number.isFinite(quantity) ? quantity * factor : null;
}

/** Gross weight in kilograms. Never derived - only what was entered. */
function grossWeightKg(item: any): number | null {
  return decimalOrNull(item?.grossWeight);
}

/** Number of packages on a line. */
function packageCount(item: any): number | null {
  const n = decimalOrNull(item?.numberOfPackages);
  return n === null ? null : Math.round(n);
}

/** Net weight per package: the line's figure, else the product's default. */
function packageWeightKg(item: any): number | null {
  return decimalOrNull(item?.packageWeight) ?? decimalOrNull(item?.product?.packageNetWeight);
}

function weightText(kg: number | null): string {
  return kg === null ? '' : `${kg.toFixed(2)} KGS`;
}

/** Sum a per-line figure, returning null when no line carries one. */
function sumOrNull(items: any[], pick: (item: any) => number | null): number | null {
  const known = items.map(pick).filter((v): v is number => v !== null);
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0);
}

/**
 * "120 BAG(S)" - the total package count with the packaging named.
 *
 * The type comes from the products on the document; when they disagree, or none is
 * set, the count stands on its own rather than claiming a packaging.
 */
function cartonsText(items: any[]): string {
  const total = sumOrNull(items, packageCount);
  if (total === null) return '';

  const types = Array.from(
    new Set(
      items
        .map((i) => i.product?.packageType)
        .filter((t: unknown): t is string => Boolean(t))
        .map((t) => t.toUpperCase())
    )
  );

  return types.length === 1 ? `${total} ${types[0]}(S)` : String(total);
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

/**
 * The exact differences between the four invoice-family sheets in MASTER DRAFT.xlsx.
 *
 * The sheets share one grid, so the renderer is one function; what varies is a
 * handful of captions and which bands appear. Holding those differences in a table
 * means each one can be checked against its cell in the workbook, rather than
 * being spread through the drawing code as `isSample ? ... : ...`.
 *
 * Cell references below are the workbook's, so a future change to a sheet can be
 * traced to the line that renders it.
 */
interface InvoiceSheetSpec {
  /** A9: the goods-code column caption. */
  codeHeader: string;
  /** E9: the rate column caption, which names the document currency. */
  rateHeader: (currencyCode: string) => string;
  /** E3: the sample sheet says "Invoice Date :" where the others say "Date:". */
  dateLabel: string;
  /**
   * C4/E4. The sample sheet has no buyer's order number - a free sample is not
   * ordered - so the IEC number occupies that row on its own.
   */
  buyersOrderNo: boolean;
  /**
   * E7, the last cell of the ports row, which differs on every sheet:
   * the commercial invoice names the container, the sample invoice states the
   * purpose of the shipment, and the proforma and packing list leave it blank.
   */
  lastPortCell: 'container' | 'purpose' | 'none';
  /** C5: the sample and packing sheets pre-state "N.A." here. */
  otherBuyer: string;
  /** A14: the carton and weight strip. The sample sheet states weights lower down. */
  weightBand: boolean;
  /** A14, proforma only: an intended quantity may vary from what ships. */
  variation: boolean;
  /** A19/A21: a sample carries no payment, so it names no bank. */
  bankDetails: boolean;
  /** The "NOT FOR SALE" stamp. */
  notForSale: boolean;
}

/**
 * The commercial invoice sheet carries the "NOT FOR SALE" stamp at A18.
 *
 * It is reproduced because the workbook is the specification. Be aware that it
 * contradicts the declaration the same sheet prints at A22 - "this Invoice shows
 * the actual Price of goods described" - and that a commercial invoice is the
 * document customs assesses duty against and the bank negotiates. If a shipment is
 * queried over it, set this to false and the stamp disappears from the commercial
 * invoice alone; the proforma, sample and packing list keep theirs.
 */
const STAMP_NOT_FOR_SALE_ON_COMMERCIAL = true;

const INVOICE_SHEETS: Record<string, InvoiceSheetSpec> = {
  COMMERCIAL: {
    codeHeader: 'Product Code',
    rateHeader: (code) => `Rate (${code}) per kg`,
    dateLabel: 'Date:',
    buyersOrderNo: true,
    lastPortCell: 'container',
    otherBuyer: '',
    weightBand: true,
    variation: false,
    bankDetails: true,
    notForSale: STAMP_NOT_FOR_SALE_ON_COMMERCIAL,
  },
  PROFORMA: {
    codeHeader: 'Product Code',
    rateHeader: (code) => `Rate (${code})`,
    dateLabel: 'Date:',
    buyersOrderNo: true,
    lastPortCell: 'none',
    otherBuyer: '',
    weightBand: true,
    variation: true,
    bankDetails: true,
    notForSale: true,
  },
  SAMPLE: {
    // Customs assesses a free sample against its tariff heading, and there is no
    // commercial price to quote a product code against.
    codeHeader: 'HS Code',
    rateHeader: (code) => `Unit Rate (${code})`,
    dateLabel: 'Invoice Date :',
    buyersOrderNo: false,
    lastPortCell: 'purpose',
    otherBuyer: 'N.A.',
    weightBand: false,
    variation: false,
    bankDetails: false,
    notForSale: true,
  },
};

/** Falls back to the commercial sheet for any type without its own layout. */
function invoiceSheet(type: string): InvoiceSheetSpec {
  return INVOICE_SHEETS[type] ?? INVOICE_SHEETS.COMMERCIAL;
}

/**
 * Item table of the invoice, quotation and purchase order sheets.
 *
 * The quantity caption is a parameter because the quotation sheet abbreviates it
 * to "QTY" where the invoices spell it out.
 */
function invoiceColumns(
  codeHeader: string,
  rateHeader: string,
  quantityHeader = 'Quantity'
): Column[] {
  return [
    { header: codeHeader, width: 0.14, align: 'center' },
    { header: 'Description of Goods', width: 0.3 },
    { header: quantityHeader, width: 0.12, align: 'right' },
    { header: 'Unit Type', width: 0.11, align: 'center' },
    { header: rateHeader, width: 0.16, align: 'right' },
    { header: 'Amount', width: 0.17, align: 'right' },
  ];
}

const PACKING_COLUMNS: Column[] = [
  { header: 'Product Code', width: 0.14, align: 'center' },
  { header: 'Description of Goods', width: 0.28 },
  { header: 'No. of Packages', width: 0.14, align: 'right' },
  { header: 'Bag / Carton Per KGs', width: 0.15, align: 'right' },
  { header: 'Net Weight', width: 0.145, align: 'right' },
  { header: 'Gross Weight', width: 0.145, align: 'right' },
];

// ---------------------------------------------------------------------------
// Common bands
// ---------------------------------------------------------------------------

/**
 * Title strip, with the logo inset at the left.
 *
 * The logo is measured before the title is drawn so the heading can be centred in
 * the space beside it. Centring across the full width instead printed the title
 * straight through the logo on documents with a long name.
 */
function titleBand(doc: Doc, y: number, title: string): number {
  const stripHeight = 40;
  const logoHeight = stripHeight - 10;

  let logo: any = null;
  let inset = 0;

  const logoPath = getLogoPath();
  if (logoPath) {
    try {
      // openImage reports the intrinsic size, which is what makes the reserved
      // width match the drawn width whatever logo file is dropped in.
      logo = (doc as any).openImage(logoPath);
      inset = (logo.width / logo.height) * logoHeight + 12;
    } catch {
      logo = null;
    }
  }

  const end = bannerRow(doc, y, title, {
    fontSize: 17,
    minHeight: stripHeight,
    insetLeft: inset,
  });

  if (logo) {
    try {
      doc.image(logo, LAYOUT.left + 5, y + 5, { height: logoHeight });
    } catch {
      // A logo that fails to draw must not fail the document.
    }
  }

  return end;
}

/**
 * The shipment strip shared by the invoice sheets and the packing list: dispatch
 * and shipment type beside origin and destination, then the ports, vessel and
 * container.
 *
 * `lastPortCell` selects the last cell, which differs on every sheet: the
 * commercial invoice captions the container, the sample invoice states the purpose
 * of the shipment, and the proforma and packing list leave an uncaptioned box there.
 */
function shipmentBands(
  doc: Doc,
  y: number,
  order: any,
  buyer: any,
  companyProfile: any,
  shipment: any,
  lastPortCell: 'container' | 'purpose' | 'none',
  purpose?: string | null
): number {
  y = bandRow(doc, y, [
    { width: 0.25, label: 'Mathod Of Dispatch:', value: dispatchMethod(order, shipment) },
    { width: 0.25, label: 'Type Of Shipment:', value: shipmentType(order, shipment) },
    {
      width: 0.25,
      label: 'Country of Origin of Goods:',
      value: (companyProfile?.originCountry || companyProfile?.country || 'INDIA').toUpperCase(),
    },
    {
      width: 0.25,
      label: 'Country of Final Destination:',
      value: (buyer?.country?.name || '').toUpperCase(),
    },
  ]);

  const lastCell: Cell =
    lastPortCell === 'container'
      ? { width: 0.25, label: 'Container No :', value: shipment?.containerNumber || '' }
      : lastPortCell === 'purpose'
        ? {
            width: 0.25,
            label: 'Purpose:',
            // The reason entered on the invoice, falling back to the standard
            // wording so an untouched sample invoice still states one.
            value: purpose || DECLARATIONS.samplePurpose,
          }
        : { width: 0.25, value: '' };

  return bandRow(doc, y, [
    {
      width: 0.25,
      label: 'Port Of Loading :',
      value: shipment?.originPort?.name || order?.portOfLoading?.name || '',
    },
    {
      width: 0.25,
      label: 'Port Of Discharge:',
      value: shipment?.destinationPort?.name || order?.portOfDischarge?.name || '',
    },
    { width: 0.25, label: 'Vessel / Flight No :', value: shipment?.vesselName || '' },
    lastCell,
  ]);
}

/** The signatory block that closes every document. */
function signatoryRows(companyProfile: any): Cell[][] {
  return [
    [
      {
        width: 1,
        label: 'Signatory Company:',
        value: (companyProfile?.legalName || FALLBACK_EXPORTER).toUpperCase(),
      },
    ],
    [
      {
        width: 1,
        label: 'Name Of Authorised Signatory:',
        value: (companyProfile?.contactPerson || '').toUpperCase(),
      },
    ],
  ];
}

/** Declaration beside the signature box, as the master sheets close. */
function signatureBand(doc: Doc, y: number, declaration: string): number {
  return bandRow(doc, y, [
    { width: 0.4, value: declaration, bold: true, fontSize: 7.5 },
    { width: 0.6, label: 'Signature:', minHeight: 56 },
  ]);
}

/**
 * How a document is to be rendered.
 *
 * Every stored amount is INR. A document is presented in whatever currency the
 * buyer deals in, at a rate the operator states when generating it, and both are
 * recorded on the document so a reprint reproduces it.
 */
export interface DocumentRenderOptions {
  currencyCode: string;
  currencySymbol: string;
  /** INR per one unit of currencyCode. 1 when printing in INR. */
  rate: number;
  /** The exporter's own details, printed as the letterhead. */
  companyProfile?: any;
}

const DEFAULT_RENDER: DocumentRenderOptions = {
  currencyCode: 'INR',
  currencySymbol: '₹',
  rate: 1,
};

// ---------------------------------------------------------------------------
// Quotation - "QUOTE FORMATE" sheet
// ---------------------------------------------------------------------------

export async function generateQuotationPDF(
  quotation: any,
  options: DocumentRenderOptions = DEFAULT_RENDER
): Promise<Buffer> {
  const { doc, done } = createDocument();
  const { currencyCode, rate, companyProfile } = options;

  // Additional costs are billed to the buyer but belong to the quotation as a
  // whole, and this table has a single amount column with no charges line. So the
  // charges are folded into the unit prices, which keeps Qty x Price = Amount on
  // every row and makes the column sum to the quoted total.
  //
  // Inputs are converted into the document currency FIRST, so the helper's
  // precision reconciliation happens in the currency the buyer will check with a
  // calculator. Converting afterwards would round each figure independently and
  // could leave the rows failing to sum to the total.
  const additionalCostsTotal = fromINR(
    (quotation.costs ?? []).reduce((sum: number, cost: any) => sum + Number(cost.amount ?? 0), 0),
    rate
  );
  const sourceItems: any[] = quotation.items ?? [];
  const pricing = calculateInclusiveUnitPrices(
    sourceItems.map((item: any) => ({
      quantity: Number(item.quantity ?? 0),
      unitPrice: fromINR(item.unitPrice, rate),
    })),
    additionalCostsTotal
  );
  // pricing.lines is built by mapping the items in order, so indexes line up.
  const items = sourceItems.map((item: any, index: number) => ({
    ...item,
    printUnitPrice: pricing.lines[index]?.unitPrice ?? fromINR(item.unitPrice, rate),
    printAmount: pricing.lines[index]?.amount ?? fromINR(item.totalPrice, rate),
    printDecimals: pricing.lines[index]?.decimals ?? 2,
  }));

  try {
    // The quotation sheet abbreviates the quantity column to "QTY" and captions the
    // rate simply "Price"; the currency is stated in its own cell lower down.
    const columns = invoiceColumns('Product Code', 'Price', 'QTY');
    let y = titleBand(doc, LAYOUT.continuationTop, 'Quotation');

    y = splitRow(
      doc,
      y,
      0.5,
      {
        width: 1,
        label: 'Seller',
        // The quotation sheet writes "IEC - ..." here and carries no GST line.
        lines: exporterLines(companyProfile, { iec: true, iecSeparator: '-' }),
        minHeight: 92,
      },
      [
        [
          { width: 0.5, label: 'Quotation Number:', value: quotation.quotationNumber || '' },
          { width: 0.5, label: 'Date:', value: dateText(quotation.createdAt) },
        ],
        [
          {
            width: 0.5,
            label: 'Buyer Reference:',
            // Quotation has no buyer-reference column. The inquiry it answers is
            // the reference the buyer will recognise; blank when quoted cold.
            value: quotation.inquiry?.inquiryNumber || '',
          },
          { width: 0.5, label: 'Expiry:', value: dateText(quotation.validUntil) },
        ],
      ]
    );

    // The quotation sheet gives the buyer the full width - there is no separate
    // consignee at quoting stage.
    y = bandRow(doc, y, [
      { width: 1, label: 'Buyer', lines: partyLines(quotation.buyer), minHeight: 78 },
    ]);

    // Payment terms span both port rows on the right (C6:F7 in the sheet).
    y = splitRow(
      doc,
      y,
      0.5,
      [
        [
          {
            width: 0.5,
            label: 'Mathod Of Dispatch:',
            // Quotation stores these two directly, unlike an invoice, where they
            // have to be read off the shipment and the port.
            value: quotation.dispatchMethod || dispatchMethod(quotation, null),
          },
          { width: 0.5, label: 'Type Of Shipment:', value: quotation.shipmentType || '' },
        ],
        [
          { width: 0.5, label: 'Port Of Loading :', value: quotation.portOfLoading?.name || '' },
          { width: 0.5, label: 'Port Of Discharge:', value: quotation.portOfDischarge?.name || '' },
        ],
      ],
      {
        width: 1,
        label: 'Terms / Mathod Of Payment',
        value: quotation.paymentTerms || '',
      }
    );

    y = bannerRow(doc, y, 'PRODUCT DISCRIPTION', { fontSize: 11, fill: DOC_COLORS.headFill });
    y = tableHeader(doc, y, columns);

    for (const item of items) {
      y = tableRow(doc, y, columns, [
        item.product?.code || item.product?.hsnCode || '',
        item.product?.name || '',
        qtyText(item.quantity),
        item.unit || item.product?.unit || 'KG',
        money(item.printUnitPrice, currencyCode, item.printDecimals),
        money(item.printAmount, currencyCode),
      ]);
    }
    y = tableFiller(doc, y, columns, Math.max(0, MIN_ITEM_ROWS - items.length));

    // TOTAL spans A:E in the sheet, so it sits over the Amount column.
    y = bandRow(doc, y, [
      { width: 0.83, value: 'TOTAL', align: 'right', bold: true, fontSize: 9 },
      { width: 0.17, value: money(pricing.total, currencyCode), align: 'right', bold: true, fontSize: 9 },
    ]);

    /**
     * Terms occupy A21:B24 of the master sheet as bare bullets, with no caption.
     *
     * The sheet's own four bullets are the fallback, so a company that has not
     * written its own terms still issues the approved wording. The first bullet is
     * blank in the draft where the Incoterm belongs; the quotation knows it, so it
     * is filled in.
     */
    const savedTerms = (companyProfile?.quotationTerms || '')
      .split('\n')
      .map((line: string) => line.trim())
      .filter(Boolean);

    const incotermCode = quotation.incoterm?.code || '';
    const terms =
      savedTerms.length > 0
        ? savedTerms
        : [
            `\u2022 Prices quoted are on ${incotermCode} Basis as per Incoterms`.replace('  ', ' '),
            '\u2022 Goods supplied shall comply with the applicable food safety regulations as per country relevant international food safety standards.',
            '\u2022 Inspection will be conducted at seller\u2019s premises. Third-party inspection if required will be borne by buyer.',
            '\u2022 Seller shall not be liable for delay or non-performance due to circumstances beyond control such as natural calamities, war, strike, government restrictions, etc.',
          ];

    y = ensureRoom(doc, y, 150);
    y = splitRow(
      doc,
      y,
      0.5,
      {
        width: 1,
        lines: terms,
        minHeight: 96,
        fontSize: 7.5,
      },
      [
        [
          {
            width: 0.66,
            label: 'Incoterms:',
            value: [quotation.incoterm?.code, quotation.incoterm?.name].filter(Boolean).join(' - '),
          },
          { width: 0.34, label: 'Currency:', value: currencyCode },
        ],
        ...signatoryRows(companyProfile),
        // A21:B24 spans the signature row on the quotation sheet, so the signature
        // box is the last row of this split rather than a band of its own.
        [{ width: 1, label: 'Signature:', minHeight: 52 }],
      ]
    );

    finalise(doc, conversionNote(currencyCode, rate));
  } catch (error) {
    doc.end();
    throw error;
  }

  return done;
}

// ---------------------------------------------------------------------------
// Invoices - "Commercial Invoice", "Proforma Invoice", "Sample Invoice" sheets
// ---------------------------------------------------------------------------

export async function generateInvoicePDF(
  invoice: any,
  options: DocumentRenderOptions = DEFAULT_RENDER
): Promise<Buffer> {
  const { doc, done } = createDocument();
  const { currencyCode, rate, companyProfile } = options;

  const sheet = invoiceSheet(invoice.type);
  const isSample = invoice.type === 'SAMPLE';

  const order = invoice.order;
  const items: any[] = order?.items ?? [];
  const shipment = order?.shipments?.[0];

  try {
    const columns = invoiceColumns(sheet.codeHeader, sheet.rateHeader(currencyCode));

    let y = titleBand(
      doc,
      LAYOUT.continuationTop,
      INVOICE_TYPE_DOCUMENT_TITLES[invoice.type] ?? INVOICE_TYPE_DOCUMENT_TITLES.COMMERCIAL
    );

    // C3/E3 above C4/E4. The sample sheet has no buyer's order number, so the IEC
    // number takes that row on its own.
    const headerRows: Cell[][] = [
      [
        { width: 0.5, label: 'Invoice No:', value: invoice.invoiceNumber || '' },
        { width: 0.5, label: sheet.dateLabel, value: dateText(invoice.invoiceDate) },
      ],
      sheet.buyersOrderNo
        ? [
            { width: 0.5, label: "Buyer's Order No :", value: order?.poNumber || '' },
            { width: 0.5, label: 'IEC No:', value: companyProfile?.iecCode || '' },
          ]
        : [{ width: 1, label: 'IEC No:', value: companyProfile?.iecCode || '' }],
    ];

    y = splitRow(
      doc,
      y,
      0.5,
      { width: 1, label: 'Exporter', lines: exporterLines(companyProfile), minHeight: 92 },
      headerRows
    );

    y = bandRow(doc, y, [
      { width: 0.5, label: 'Consignee', lines: partyLines(invoice.buyer), minHeight: 86 },
      // "Consinee" is the spelling on every master sheet; it is reproduced so the
      // printed document matches the approved draft rather than quietly differing.
      //
      // Filled from the order's bill-to party when the goods are consigned to one
      // address and invoiced to another. Empty otherwise, which is the normal case
      // and what the draft shows.
      {
        width: 0.5,
        label: 'Buyer ( If Other than Consinee ) :',
        lines: order?.billToBuyer ? partyLines(order.billToBuyer) : undefined,
        value: order?.billToBuyer ? undefined : sheet.otherBuyer,
      },
    ]);

    y = shipmentBands(
      doc,
      y,
      order,
      invoice.buyer,
      companyProfile,
      shipment,
      sheet.lastPortCell,
      invoice.purpose
    );

    y = bannerRow(doc, y, 'PRODUCT DISCRIPTION', { fontSize: 11, fill: DOC_COLORS.headFill });
    y = tableHeader(doc, y, columns);

    for (const item of items) {
      // Rate and amount are reconciled so the row multiplies out as printed.
      const line = reconcileLine(fromINR(item.unitPrice, rate), Number(item.quantity ?? 0));
      y = tableRow(doc, y, columns, [
        // The goods code. `hsnCode` and `code` are the real columns on Product;
        // this used to read `hsCode` and `sku`, which do not exist, so the column
        // printed blank on every document.
        (isSample ? item.product?.hsnCode : item.product?.code) ||
          item.product?.hsnCode ||
          item.product?.code ||
          '',
        item.product?.name || '',
        qtyText(item.quantity),
        item.unit || item.product?.unit || 'KG',
        money(line.rate, currencyCode, line.decimals),
        money(line.amount, currencyCode),
      ]);
    }
    y = tableFiller(doc, y, columns, Math.max(0, MIN_ITEM_ROWS - items.length));

    // Weight block. See the comment on MASS_UNITS_IN_KG for which figures are
    // stored and which are derived.
    //
    // The sample sheet has no carton block - it states net and gross weight in the
    // footer instead, so printing both here would duplicate it.
    const netKg = sumOrNull(items, netWeightKg);
    const grossKg = sumOrNull(items, grossWeightKg);
    if (sheet.weightBand) {
      const w = sheet.variation ? 0.25 : 0.34;
      const weightCells: Cell[] = [
        { width: w, label: 'Total Cartons / Box :', value: cartonsText(items) },
        { width: sheet.variation ? 0.25 : 0.33, label: 'Net Weight :', value: weightText(netKg) },
        {
          width: sheet.variation ? 0.25 : 0.33,
          label: 'Gross Weight :',
          value: weightText(grossKg),
        },
      ];
      if (sheet.variation) {
        const variation = decimalOrNull(order?.variationPercent);
        weightCells.push({
          width: 0.25,
          label: 'Variation % +/- :',
          value: variation === null ? '' : `${variation}%`,
        });
      }
      y = bandRow(doc, y, weightCells);
    }

    const totalAmount = fromINR(invoice.totalAmount, rate);
    y = bandRow(doc, y, [
      {
        width: 0.66,
        label: 'Amount in words :',
        value: amountInWords(totalAmount, currencyCode),
      },
      { width: 0.17, value: 'TOTAL', align: 'right', bold: true, fontSize: 9 },
      {
        width: 0.17,
        value: money(totalAmount, currencyCode),
        align: 'right',
        bold: true,
        fontSize: 9,
      },
    ]);

    if (sheet.notForSale) {
      y = bannerRow(doc, y, DECLARATIONS.notForSale, {
        fontSize: 18,
        minHeight: 34,
        color: DOC_COLORS.stamp,
      });
    }

    y = ensureRoom(doc, y, 170);

    if (!sheet.bankDetails) {
      // A sample carries no payment, so there are no bank details: the free-sample
      // declaration takes that space instead.
      y = bandRow(doc, y, [
        { width: 0.66, value: sampleDeclaration(items), bold: true, fontSize: 7.5 },
        { width: 0.34, label: 'Currency:', value: currencyCode },
      ]);

      y = splitRow(
        doc,
        y,
        0.5,
        {
          width: 1,
          lines: [
            `Net Weight : ${weightText(netKg)}`,
            `Gross Weight : ${weightText(grossKg)}`,
          ],
          minHeight: 56,
        },
        signatoryRows(companyProfile)
      );

      signatureBand(doc, y, DECLARATIONS.nonHazardous);
    } else {
      // The proforma sheet prints the same declaration as the commercial one
      // (A24 and A22 respectively), so both use it. CompanyProfile.invoiceDeclaration
      // overrides the wording when one has been saved.
      const declaration = companyProfile?.invoiceDeclaration || DECLARATIONS.commercial;

      y = splitRow(
        doc,
        y,
        0.5,
        { width: 1, label: 'Bank Details:', lines: bankLines(companyProfile), minHeight: 96, fontSize: 7.5 },
        [
          [
            {
              width: 0.66,
              label: 'Terms of Delivery ( Incoterms ) and Payment :',
              lines: [
                [order?.incoterm?.code, order?.incoterm?.name].filter(Boolean).join(' - '),
                order?.paymentTerms || invoice.termsConditions || '',
              ],
            },
            { width: 0.34, label: 'Currency:', value: currencyCode },
          ],
          ...signatoryRows(companyProfile),
        ]
      );

      signatureBand(doc, y, declaration);
    }

    finalise(doc, conversionNote(currencyCode, rate));
  } catch (error) {
    doc.end();
    throw error;
  }

  return done;
}

// ---------------------------------------------------------------------------
// Packing list - "Packing List" sheet
// ---------------------------------------------------------------------------

export async function generatePackingListPDF(
  invoice: any,
  options: DocumentRenderOptions = DEFAULT_RENDER
): Promise<Buffer> {
  const { doc, done } = createDocument();
  const { companyProfile } = options;

  const order = invoice.order;
  const items: any[] = order?.items ?? [];
  const shipment = order?.shipments?.[0];
  /**
   * The commercial invoice this packing list goes with.
   *
   * Resolved from the other invoices on the same order rather than stored as a
   * link, because there is one commercial invoice per order in practice and a
   * stored link would be another thing to keep correct. Blank when the packing list
   * was produced before the invoice, which is a legitimate order of events.
   */
  const relatedInvoiceNumber: string | null =
    (order?.invoices ?? []).find(
      (i: any) => i.id !== invoice.id && !isDocumentOnlyInvoice(i.type)
    )?.invoiceNumber ?? null;

  try {
    const columns = PACKING_COLUMNS;
    // "Packing List", in title case, is how the master sheet heads this document -
    // it is the one document of the six that is not an all-caps heading.
    let y = titleBand(
      doc,
      LAYOUT.continuationTop,
      INVOICE_TYPE_DOCUMENT_TITLES.PACKING_LIST
    );

    y = splitRow(
      doc,
      y,
      0.5,
      { width: 1, label: 'Exporter', lines: exporterLines(companyProfile), minHeight: 92 },
      [
        [
          {
            width: 0.5,
            label: 'Packing List No :',
            // The document's own number. Packing lists are numbered in their own
            // series, so this is the number a customs officer or shipping line
            // quotes back. Older records created before that had an invoice number
            // here, which is why it falls back rather than printing blank.
            value: invoice.invoiceNumber || '',
          },
          { width: 0.5, label: 'Date:', value: dateText(invoice.invoiceDate) },
        ],
        [
          {
            width: 0.5,
            label: 'Invoice No:',
            // The commercial invoice this packing list accompanies, which is what
            // the two documents are matched on at the port.
            value: relatedInvoiceNumber || '',
          },
          { width: 0.5, label: 'IEC No:', value: companyProfile?.iecCode || '' },
        ],
      ]
    );

    y = bandRow(doc, y, [
      { width: 0.5, label: 'Consignee', lines: partyLines(invoice.buyer), minHeight: 86 },
      // Spelling and the prefilled "N.A." are as the master sheet has them.
      { width: 0.5, label: 'Buyer ( If Other than Consinee ) :', value: 'N.A.' },
    ]);

    // The packing list sheet leaves E7:F7 an empty box, like the proforma and
    // sample sheets; only the commercial invoice captions the container.
    y = shipmentBands(doc, y, order, invoice.buyer, companyProfile, shipment, 'none');

    y = bannerRow(doc, y, 'PRODUCT DISCRIPTION', { fontSize: 11, fill: DOC_COLORS.headFill });
    y = tableHeader(doc, y, columns);

    for (const item of items) {
      const packages = packageCount(item);
      const perPackage = packageWeightKg(item);
      y = tableRow(doc, y, columns, [
        item.product?.code || item.product?.hsnCode || '',
        item.product?.name || '',
        packages === null ? '' : String(packages),
        weightText(perPackage),
        weightText(netWeightKg(item)),
        weightText(grossWeightKg(item)),
      ]);
    }
    y = tableFiller(doc, y, columns, Math.max(0, MIN_ITEM_ROWS - items.length));

    const netKg = sumOrNull(items, netWeightKg);
    const grossKg = sumOrNull(items, grossWeightKg);
    const totalPackages = sumOrNull(items, packageCount);
    y = bandRow(doc, y, [
      { width: 0.42, value: 'TOTAL', align: 'right', bold: true, fontSize: 9 },
      {
        width: 0.14,
        value: totalPackages === null ? '' : String(totalPackages),
        align: 'right',
        bold: true,
      },
      // Weight per package is a per-line figure; a total of it would be meaningless.
      { width: 0.15, value: '', align: 'right' },
      { width: 0.145, value: weightText(netKg), align: 'right', bold: true },
      { width: 0.145, value: weightText(grossKg), align: 'right', bold: true },
    ]);

    if (isDocumentOnlyInvoice(invoice.type)) {
      y = bannerRow(doc, y, DECLARATIONS.notForSale, {
        fontSize: 18,
        minHeight: 34,
        color: DOC_COLORS.stamp,
      });
    }

    y = ensureRoom(doc, y, 170);
    y = splitRow(
      doc,
      y,
      0.5,
      {
        width: 1,
        lines: [
          `Total Cartons / Box : ${cartonsText(items)}`,
          `Net Weight : ${weightText(netKg)}`,
          `Gross Weight : ${weightText(grossKg)}`,
        ],
        minHeight: 76,
      },
      [
        [
          {
            width: 1,
            value: packingDeclaration(items, isDocumentOnlyInvoice(invoice.type)),
            bold: true,
            fontSize: 7.5,
          },
        ],
        ...signatoryRows(companyProfile),
      ]
    );

    signatureBand(doc, y, DECLARATIONS.nonHazardousStamp);

    finalise(doc);
  } catch (error) {
    doc.end();
    throw error;
  }

  return done;
}

// ---------------------------------------------------------------------------
// Purchase order - "PO" sheet
// ---------------------------------------------------------------------------

/**
 * Purchase order sent to a supplier.
 *
 * Always INR: this is a domestic purchase from an Indian supplier, and every
 * stored amount is already in rupees, so there is nothing to convert.
 */
export async function generatePurchaseOrderPDF(
  procurement: any,
  options: { companyProfile?: any } = {}
): Promise<Buffer> {
  const { doc, done } = createDocument();
  const { companyProfile } = options;
  const currencyCode = 'INR';

  const items: any[] = procurement.order?.items ?? [];

  /** Terms saved on the company profile, one clause per line. */
  const savedPoTerms: string[] = (companyProfile?.purchaseOrderTerms || '')
    .split('\n')
    .map((line: string) => line.trim())
    .filter(Boolean);

  try {
    const columns = invoiceColumns('Product Code', `Rate (${currencyCode})`);
    let y = titleBand(doc, LAYOUT.continuationTop, 'PURCHASE ORDER');

    y = splitRow(
      doc,
      y,
      0.5,
      {
        width: 1,
        label: 'Purchaser (Buyer)',
        // The PO sheet has no separate IEC cell, so both numbers sit in this block.
        lines: exporterLines(companyProfile, { gst: true, iec: true }),
        minHeight: 92,
      },
      [
        [
          { width: 0.5, label: 'PO Number:', value: procurement.poNumber || '' },
          { width: 0.5, label: 'Date:', value: dateText(procurement.orderDate) },
        ],
        [
          {
            width: 0.5,
            label: 'Supplier Ref / Quotation No:',
            value: procurement.order?.orderNumber || '',
          },
          {
            width: 0.5,
            label: 'Expected Delivery Date:',
            value: dateText(procurement.expectedDate),
          },
        ],
      ]
    );

    y = bandRow(doc, y, [
      {
        width: 0.5,
        label: 'Supplier / Vendor',
        lines: supplierLines(procurement.supplier),
        minHeight: 86,
      },
      {
        width: 0.5,
        label: 'Delivery / Consignment Address (if different from Purchaser):',
        value: procurement.deliveryAddress || '',
      },
    ]);

    y = bandRow(doc, y, [
      { width: 0.34, label: 'Mode of Delivery:', value: procurement.modeOfDelivery || '' },
      {
        width: 0.33,
        label: 'Expected Mode of Payment:',
        // Falls back to the supplier's standing terms, which is what applies when
        // nothing specific was agreed for this order.
        value: procurement.paymentMode || procurement.supplier?.paymentTerms || '',
      },
      { width: 0.33, label: 'Order Currency:', value: currencyCode },
    ]);

    y = bandRow(doc, y, [
      {
        width: 0.34,
        label: 'Delivery / Pickup Location:',
        value: procurement.pickupLocation || '',
      },
      { width: 0.33, label: 'Destination:', value: procurement.destination || '' },
      {
        width: 0.33,
        label: 'Required By:',
        value: dateText(procurement.expectedDate),
      },
    ]);

    y = bannerRow(doc, y, 'PRODUCT / MATERIAL ORDERED', {
      fontSize: 11,
      fill: DOC_COLORS.headFill,
    });
    y = tableHeader(doc, y, columns);

    for (const item of items) {
      y = tableRow(doc, y, columns, [
        item.product?.code || item.product?.hsnCode || '',
        item.product?.name || '',
        qtyText(item.quantity),
        item.unit || item.product?.unit || 'KG',
        money(item.unitPrice, currencyCode),
        money(item.totalPrice, currencyCode),
      ]);
    }
    y = tableFiller(doc, y, columns, Math.max(0, MIN_ITEM_ROWS - items.length));

    // A14:F16 - packing and quality requirements placed on the supplier, above the
    // total. Procurement carries one free-text `notes` field, which is where an
    // operator writes packing instructions today.
    y = bandRow(doc, y, [
      {
        width: 0.5,
        label: 'Packing Instructions:',
        // Falls back to notes, which is where packing instructions had to be
        // written before this field existed.
        value: procurement.packingInstructions || procurement.notes || '',
      },
      { width: 0.3, label: 'Quality Requirement:', value: procurement.qualityRequirement || '' },
      {
        width: 0.2,
        label: 'Variation % +/- :',
        value:
          procurement.variationPercent === null || procurement.variationPercent === undefined
            ? ''
            : `${Number(procurement.variationPercent)}%`,
      },
    ]);

    // The order total is what was agreed with the supplier, which is the figure on
    // the procurement record rather than a sum of the export order's own lines.
    const total = Number(procurement.totalAmount ?? 0);
    y = bandRow(doc, y, [
      { width: 0.66, label: 'Amount in words :', value: amountInWords(total, currencyCode) },
      { width: 0.17, value: 'TOTAL', align: 'right', bold: true, fontSize: 9 },
      { width: 0.17, value: money(total, currencyCode), align: 'right', bold: true, fontSize: 9 },
    ]);

    y = ensureRoom(doc, y, 190);
    y = splitRow(
      doc,
      y,
      0.5,
      {
        width: 1,
        label: 'Terms & Conditions:',
        // Saved terms win; the master sheet's clauses are the fallback so a PO is
        // never sent without terms on it.
        lines:
          savedPoTerms.length > 0
            ? savedPoTerms
            : PO_TERMS(companyProfile?.legalName || FALLBACK_EXPORTER),
        minHeight: 96,
        fontSize: 7,
      },
      [
        [
          {
            width: 0.75,
            label: 'Terms of Delivery and Payment :',
            value: procurement.paymentMode || procurement.supplier?.paymentTerms || '',
          },
          { width: 0.25, label: 'Currency:', value: currencyCode },
        ],
        [
          {
            width: 1,
            label: 'Signatory Company:',
            value: (companyProfile?.legalName || FALLBACK_EXPORTER).toUpperCase(),
          },
        ],
        [
          {
            width: 1,
            label: 'Name Of Authorised Signatory:',
            lines: [(companyProfile?.contactPerson || '').toUpperCase(), '', 'Signature:'],
            minHeight: 56,
          },
        ],
      ]
    );

    // A21:F21 - the closing statement runs the full width of the frame.
    bandRow(doc, y, [
      {
        width: 1,
        value:
          'This Purchase Order is issued in good faith based on the specifications and ' +
          'pricing discussed. It becomes binding once acknowledged by the Supplier.',
        bold: true,
        fontSize: 7.5,
        align: 'center',
      },
    ]);

    finalise(doc);
  } catch (error) {
    doc.end();
    throw error;
  }

  return done;
}
