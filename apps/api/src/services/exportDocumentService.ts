/**
 * Export document generator.
 *
 * Reproduces the layout of MASTER DRAFT.xlsx as PDF. All five documents share
 * one grid, so the frame is drawn once and each document supplies only its
 * title, line-item columns and footer blocks:
 *
 *   Quotation | Sample Invoice | Proforma Invoice | Packing List | Commercial Invoice
 *
 * Grid (matching the spreadsheet's A..F columns):
 *   r1        title band
 *   r2-r4     exporter block (left)  +  document no./date pairs (right)
 *   r5        consignee block
 *   r6-r7     dispatch / shipment type / origin / ports / vessel
 *   r8-r9     "PRODUCT DESCRIPTION" + column headers
 *   r10+      line items
 *   totals    amount + amount in words
 *   footer    bank details, terms, declaration
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

type Doc = PDFKit.PDFDocument;

const COLORS = {
  navy: '#1e3a5f',
  gold: '#c9a227',
  text: '#000000',
  muted: '#555555',
  line: '#000000',
  headerFill: '#e8eef4',
};

/** Page geometry. The spreadsheet is 6 columns (A..F) across the width. */
const PAGE = {
  margin: 36,
  left: 36,
  right: 559, // A4 width 595 - margin
  get width() {
    return this.right - this.left;
  },
};

const LOGO_PATH = path.resolve(__dirname, '../../assets/logo.png');
const LOGO_EXISTS = (() => {
  try {
    return fs.existsSync(LOGO_PATH);
  } catch {
    return false;
  }
})();

// ---------------------------------------------------------------- helpers

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function money(value: unknown, decimals = 2): string {
  return num(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Trim trailing zeros so quantities read 100 rather than 100.00. */
function qty(value: unknown): string {
  const n = num(value);
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
}

function formatDate(value: unknown): string {
  if (!value) return '-';
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleString('en-GB', { month: 'short' });
  return `${day}-${month}-${d.getFullYear()}`;
}

const ONES = [
  '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN',
  'EIGHTEEN', 'NINETEEN',
];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

function chunkToWords(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
  }
  return `${ONES[Math.floor(n / 100)]} HUNDRED${n % 100 ? ' ' + chunkToWords(n % 100) : ''}`;
}

/**
 * Amount in words, as the templates print it, e.g.
 * "USD FIVE THOUSAND NINE HUNDRED ONLY".
 * Uses the international scale (thousand / million) rather than lakh / crore,
 * since these documents go to overseas buyers.
 */
export function amountInWords(amount: number, currency = 'USD'): string {
  const whole = Math.floor(Math.abs(num(amount)));
  const cents = Math.round((Math.abs(num(amount)) - whole) * 100);

  if (whole === 0 && cents === 0) return `${currency} ZERO ONLY`;

  const scales: [number, string][] = [
    [1_000_000_000, 'BILLION'],
    [1_000_000, 'MILLION'],
    [1_000, 'THOUSAND'],
  ];

  let remaining = whole;
  const parts: string[] = [];
  for (const [value, name] of scales) {
    if (remaining >= value) {
      parts.push(`${chunkToWords(Math.floor(remaining / value))} ${name}`);
      remaining %= value;
    }
  }
  if (remaining > 0) parts.push(chunkToWords(remaining));

  let words = `${currency} ${parts.join(' ')}`;
  if (cents > 0) words += ` AND ${chunkToWords(cents)} CENTS`;
  return `${words} ONLY`;
}

// ---------------------------------------------------------------- primitives

/** Draw a bordered cell and return the y position just below it. */
function cell(
  doc: Doc,
  opts: {
    x: number;
    y: number;
    w: number;
    h: number;
    label?: string;
    value?: string;
    fill?: string;
    bold?: boolean;
    align?: 'left' | 'center' | 'right';
    size?: number;
    valueSize?: number;
  }
) {
  const { x, y, w, h, label, value, fill, bold, align = 'left', size = 7, valueSize } = opts;

  if (fill) doc.fillColor(fill).rect(x, y, w, h).fill();
  doc.strokeColor(COLORS.line).lineWidth(0.5).rect(x, y, w, h).stroke();

  let ty = y + 3;
  if (label) {
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(size)
      .text(label, x + 3, ty, { width: w - 6, align });
    ty = doc.y + 1;
  }
  if (value) {
    doc
      .fillColor(COLORS.text)
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(valueSize ?? size + 1)
      .text(value, x + 3, ty, { width: w - 6, align });
  }
}

export interface DocumentColumn {
  header: string;
  /** Fraction of the table width. Must sum to 1 across the set. */
  width: number;
  align?: 'left' | 'center' | 'right';
  /** Cell text for a line item. */
  value: (item: any, index: number) => string;
}

export interface FooterBlock {
  title?: string;
  body: string;
}

export interface ExportDocumentInput {
  title: string;
  company: any;
  /** Consignee / buyer */
  buyer: any;
  /** Label + value pairs for the four header slots (r3, r4) */
  references: { label: string; value: string }[];
  dispatchMethod?: string | null;
  shipmentType?: string | null;
  originCountry?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  vesselOrFlight?: string | null;
  columns: DocumentColumn[];
  items: any[];
  /** Right-aligned totals under the table, e.g. [['TOTAL', '15,000.00']] */
  totals: [string, string][];
  amountInWordsLine?: string | null;
  /** Shown as a full-width banner, e.g. "NOT FOR SALE" */
  banner?: string | null;
  /** Packing summary line: cartons, net, gross, variation */
  summaryLine?: string | null;
  footerBlocks: FooterBlock[];
  /** Small print at the very bottom */
  declaration?: string | null;
}

/** Compose the exporter block exactly as the template prints it. */
function exporterText(company: any): string {
  const lines = [
    company?.legalName,
    company?.addressLine1,
    [company?.addressLine2, company?.city, company?.state, company?.postalCode]
      .filter(Boolean)
      .join(', '),
    company?.country,
    company?.gstNumber ? `GST : ${company.gstNumber}` : null,
    company?.iecCode ? `IEC : ${company.iecCode}` : null,
    [company?.phone, company?.contactPerson].filter(Boolean).join(' - '),
    company?.email,
  ];
  return lines.filter((l) => l && String(l).trim()).join('\n');
}

/** Compose the consignee block. */
function consigneeText(buyer: any): string {
  const contact = buyer?.contacts?.[0];
  const lines = [
    buyer?.companyName,
    buyer?.address,
    [buyer?.city, buyer?.state, buyer?.postalCode].filter(Boolean).join(', '),
    buyer?.country?.name,
    contact ? [contact.firstName, contact.lastName].filter(Boolean).join(' ') : null,
    contact?.designation,
    contact?.phone ? `Tel : ${contact.phone}` : null,
    contact?.email ? `Email : ${contact.email}` : null,
  ];
  return lines.filter((l) => l && String(l).trim()).join('\n');
}

// ---------------------------------------------------------------- generator

export function generateExportDocument(input: ExportDocumentInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, bufferPages: true });
  const chunks: Buffer[] = [];

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const W = PAGE.width;
  const L = PAGE.left;
  let y = PAGE.margin;

  // ---- r1: title band ----
  doc.fillColor(COLORS.navy).rect(L, y, W, 26).fill();
  if (LOGO_EXISTS) {
    try {
      doc.image(LOGO_PATH, L + 4, y + 4, { height: 18 });
    } catch {
      /* fall through - the title alone is enough */
    }
  }
  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(input.title.toUpperCase(), L, y + 7, { width: W, align: 'center' });
  y += 26;

  // ---- r2-r4: exporter block (left) + reference pairs (right) ----
  const halfW = W / 2;
  const exporterH = 74;
  cell(doc, {
    x: L,
    y,
    w: halfW,
    h: exporterH,
    label: 'Exporter',
    value: exporterText(input.company),
    size: 7,
    valueSize: 7.5,
  });

  // Four reference slots stacked as two rows of two
  const refs = input.references.slice(0, 4);
  const refW = halfW / 2;
  const refH = exporterH / 2;
  for (let i = 0; i < 4; i++) {
    const r = refs[i];
    cell(doc, {
      x: L + halfW + (i % 2) * refW,
      y: y + Math.floor(i / 2) * refH,
      w: refW,
      h: refH,
      label: r?.label ?? '',
      value: r?.value ?? '',
      bold: true,
    });
  }
  y += exporterH;

  // ---- r5: consignee ----
  const consigneeH = 66;
  cell(doc, {
    x: L,
    y,
    w: W,
    h: consigneeH,
    label: 'Consignee',
    value: consigneeText(input.buyer),
    size: 7,
    valueSize: 7.5,
  });
  y += consigneeH;

  // ---- r6-r7: dispatch details, three across, two rows ----
  const thirdW = W / 3;
  const detailH = 24;
  const row1: [string, string][] = [
    ['Method Of Dispatch', input.dispatchMethod ?? '-'],
    ['Type Of Shipment', input.shipmentType ?? '-'],
    ['Country of Origin of Goods', input.originCountry ?? '-'],
  ];
  const row2: [string, string][] = [
    ['Port Of Loading', input.portOfLoading ?? '-'],
    ['Port Of Discharge', input.portOfDischarge ?? '-'],
    ['Vessel / Flight No', input.vesselOrFlight ?? '-'],
  ];
  row1.forEach(([label, value], i) =>
    cell(doc, { x: L + i * thirdW, y, w: thirdW, h: detailH, label, value })
  );
  row2.forEach(([label, value], i) =>
    cell(doc, { x: L + i * thirdW, y: y + detailH, w: thirdW, h: detailH, label, value })
  );
  y += detailH * 2;

  // ---- r8: section heading ----
  cell(doc, {
    x: L,
    y,
    w: W,
    h: 16,
    value: 'PRODUCT DESCRIPTION',
    fill: COLORS.headerFill,
    bold: true,
    align: 'center',
    size: 8,
    valueSize: 8,
  });
  y += 16;

  // ---- r9: column headers ----
  const colX: number[] = [];
  let acc = L;
  for (const c of input.columns) {
    colX.push(acc);
    acc += c.width * W;
  }
  const headerH = 18;
  input.columns.forEach((c, i) => {
    cell(doc, {
      x: colX[i],
      y,
      w: c.width * W,
      h: headerH,
      value: c.header,
      fill: COLORS.headerFill,
      bold: true,
      align: c.align ?? 'left',
      size: 7,
      valueSize: 7,
    });
  });
  y += headerH;

  // ---- line items ----
  const rowH = 16;
  const pageBottom = 780;

  const drawHeaders = () => {
    input.columns.forEach((c, i) => {
      cell(doc, {
        x: colX[i],
        y,
        w: c.width * W,
        h: headerH,
        value: c.header,
        fill: COLORS.headerFill,
        bold: true,
        align: c.align ?? 'left',
        size: 7,
        valueSize: 7,
      });
    });
    y += headerH;
  };

  input.items.forEach((item, index) => {
    // Descriptions wrap, so measure before committing to a row height.
    const descCol = input.columns.findIndex((c) => /description/i.test(c.header));
    let needed = rowH;
    if (descCol >= 0) {
      const text = input.columns[descCol].value(item, index);
      const h =
        doc.font('Helvetica').fontSize(7.5).heightOfString(text, {
          width: input.columns[descCol].width * W - 6,
        }) + 6;
      needed = Math.max(rowH, h);
    }

    if (y + needed > pageBottom) {
      doc.addPage();
      y = PAGE.margin;
      drawHeaders();
    }

    input.columns.forEach((c, i) => {
      cell(doc, {
        x: colX[i],
        y,
        w: c.width * W,
        h: needed,
        value: c.value(item, index),
        align: c.align ?? 'left',
        size: 7.5,
        valueSize: 7.5,
      });
    });
    y += needed;
  });

  if (input.items.length === 0) {
    cell(doc, { x: L, y, w: W, h: rowH, value: 'No items', align: 'center', size: 7.5 });
    y += rowH;
  }

  // ---- totals ----
  const totalLabelW = W * 0.72;
  const totalValueW = W - totalLabelW;
  for (const [label, value] of input.totals) {
    if (y + rowH > pageBottom) {
      doc.addPage();
      y = PAGE.margin;
    }
    cell(doc, {
      x: L,
      y,
      w: totalLabelW,
      h: rowH,
      value: label,
      align: 'right',
      bold: true,
      size: 8,
      valueSize: 8,
      fill: COLORS.headerFill,
    });
    cell(doc, {
      x: L + totalLabelW,
      y,
      w: totalValueW,
      h: rowH,
      value: value,
      align: 'right',
      bold: true,
      size: 8,
      valueSize: 8,
      fill: COLORS.headerFill,
    });
    y += rowH;
  }

  // ---- amount in words ----
  if (input.amountInWordsLine) {
    cell(doc, {
      x: L,
      y,
      w: W,
      h: 16,
      value: `Amount in words : ${input.amountInWordsLine}`,
      bold: true,
      size: 8,
      valueSize: 8,
    });
    y += 16;
  }

  // ---- packing / weight summary ----
  if (input.summaryLine) {
    const h =
      doc.font('Helvetica').fontSize(7.5).heightOfString(input.summaryLine, { width: W - 6 }) + 8;
    cell(doc, { x: L, y, w: W, h, value: input.summaryLine, size: 7.5, valueSize: 7.5 });
    y += h;
  }

  // ---- banner, e.g. NOT FOR SALE ----
  if (input.banner) {
    cell(doc, {
      x: L,
      y,
      w: W,
      h: 18,
      value: input.banner,
      align: 'center',
      bold: true,
      size: 9,
      valueSize: 9,
      fill: COLORS.headerFill,
    });
    y += 18;
  }

  // ---- footer blocks ----
  for (const block of input.footerBlocks) {
    const text = block.title ? `${block.title}\n${block.body}` : block.body;
    const h = doc.font('Helvetica').fontSize(7).heightOfString(text, { width: W - 6 }) + 10;
    if (y + h > pageBottom) {
      doc.addPage();
      y = PAGE.margin;
    }
    cell(doc, { x: L, y, w: W, h, value: text, size: 7, valueSize: 7 });
    y += h;
  }

  // ---- declaration ----
  if (input.declaration) {
    const h =
      doc.font('Helvetica').fontSize(7).heightOfString(input.declaration, { width: W - 6 }) + 10;
    if (y + h > pageBottom) {
      doc.addPage();
      y = PAGE.margin;
    }
    cell(doc, { x: L, y, w: W, h, value: input.declaration, size: 7, valueSize: 7 });
    y += h;
  }

  // ---- signature strip ----
  if (y + 46 < pageBottom) {
    const sigW = W / 2;
    cell(doc, { x: L, y, w: sigW, h: 46, label: "Buyer's Signature", value: '' });
    cell(doc, {
      x: L + sigW,
      y,
      w: sigW,
      h: 46,
      label: `For ${input.company?.legalName ?? ''}`,
      value: '',
      align: 'right',
    });
  }

  doc.end();
  return done;
}

export { money, qty, formatDate, num };
