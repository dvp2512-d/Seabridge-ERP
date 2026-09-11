/**
 * Boxed-grid layout primitives for export documents.
 *
 * Every document in MASTER DRAFT .xlsx is the same shape: one ruled table
 * spanning the page, where each field sits in its own bordered cell with a caption
 * above the value. Customs officers, banks handling an LC, and the buyer's own
 * clerks read these documents by position, so the grid is not decoration - it is
 * the format. Freely positioned text with occasional horizontal rules, which is
 * what these documents used to be, reads as a different document even when it
 * carries identical data.
 *
 * The master sheets are six columns wide and use merged ranges to express layout:
 * a full-width title, a left half against two right quarters, a four-cell strip.
 * This module provides that vocabulary directly - `bandRow` takes cell widths as
 * fractions of the frame, so `[0.5, 0.25, 0.25]` is A:B | C:D | E:F.
 *
 * WHY HEIGHTS ARE MEASURED RATHER THAN FIXED:
 *   Excel rows have fixed heights and silently clip whatever does not fit. A PDF
 *   cannot clip - a consignee address that overflows would print over the row
 *   below. So each cell reports the height it needs and the row takes the tallest,
 *   which is why a document with a long address is a few millimetres taller rather
 *   than corrupt.
 */

// `PDFKit` is a global namespace declared by @types/pdfkit. Importing it here
// would shadow the namespace with the default-exported class and break
// `PDFKit.PDFDocument`.
type Doc = PDFKit.PDFDocument;

/**
 * Frame geometry, in points, for an A4 page (595.28 x 841.89).
 *
 * The frame is centred with equal side margins, which is what makes a ruled
 * document look like a form rather than a letter. `bottom` leaves room for the
 * page-number strip that is written after the content.
 */
export const LAYOUT = {
  /** Left edge of the ruled frame. */
  left: 34,
  /** Right edge of the ruled frame. */
  right: 561,
  /** Width of the ruled frame. */
  width: 527,
  /** Content must stop above this so it never collides with the page footer. */
  bottom: 790,
  /** Y where the frame starts, and resumes on a continuation page. */
  continuationTop: 36,
};

export const DOC_COLORS = {
  /** Grid lines. Near-black, because an export document is read as a ruled form. */
  border: '#000000',
  caption: '#000000',
  value: '#000000',
  /** Banner and column-header tint. */
  headFill: '#e9ebee',
  navy: '#1e3a5f',
  muted: '#555555',
  /** "NOT FOR SALE" and other stamps that must not be mistaken for data. */
  stamp: '#b00000',
};

const FONT = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
};

/** Padding inside every cell. */
const PAD = 4;

export interface Cell {
  /**
   * Share of the available width, as a fraction. Fractions in a row should sum to
   * 1; any shortfall is absorbed by the last cell so rounding never leaves a
   * hairline gap at the right edge of the frame.
   */
  width: number;
  /** Caption at the top of the cell, e.g. "Invoice No:". Always bold. */
  label?: string;
  /** Value under the caption. Blank prints an empty box, never "null". */
  value?: string;
  /** Further value lines, each on its own line. */
  lines?: string[];
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  fontSize?: number;
  /** Force the cell, and so the row, to be at least this tall. */
  minHeight?: number;
  /** Vertically centre the content instead of top-aligning it. */
  middle?: boolean;
  /** Override the value colour, for stamps and declarations. */
  color?: string;
}

export interface Column {
  header: string;
  /** Share of the frame width, as a fraction. */
  width: number;
  align?: 'left' | 'center' | 'right';
}

/** One side of a split row: a single tall cell, or a stack of rows. */
export type Side = Cell | Cell[][];

/** Value lines of a cell, with blanks dropped so empty fields stay empty. */
function cellText(cell: Cell): string[] {
  const out: string[] = [];
  if (cell.value !== undefined && cell.value !== null && cell.value !== '') {
    out.push(String(cell.value));
  }
  for (const line of cell.lines ?? []) {
    if (line !== undefined && line !== null && line !== '') out.push(String(line));
  }
  return out;
}

/** Resolve fractional widths to absolute widths that fill `total` exactly. */
function resolveWidths(fractions: number[], total: number): number[] {
  const widths = fractions.map((f) => Math.round(f * total));
  const drift = total - widths.reduce((a, b) => a + b, 0);
  if (widths.length > 0) widths[widths.length - 1] += drift;
  return widths;
}

/** Height a cell needs, including padding. */
function measureCell(doc: Doc, cell: Cell, width: number): number {
  const inner = width - PAD * 2;
  const size = cell.fontSize ?? 8;
  let h = PAD * 2;

  if (cell.label) {
    doc.font(FONT.bold).fontSize(size);
    h += doc.heightOfString(cell.label, { width: inner }) + 1;
  }

  const lines = cellText(cell);
  if (lines.length > 0) {
    doc.font(cell.bold ? FONT.bold : FONT.regular).fontSize(size);
    for (const line of lines) {
      h += doc.heightOfString(line, { width: inner });
    }
  }

  return Math.max(h, cell.minHeight ?? 0);
}

/** Draw one cell's border and content at an absolute position. */
function paintCell(doc: Doc, cell: Cell, x: number, y: number, width: number, height: number) {
  doc.strokeColor(DOC_COLORS.border).lineWidth(0.7).rect(x, y, width, height).stroke();

  const inner = width - PAD * 2;
  const size = cell.fontSize ?? 8;
  const align = cell.align ?? 'left';
  const lines = cellText(cell);

  // A centred cell needs its content height before the first draw, so it is
  // measured rather than accumulated.
  let cursor = y + PAD;
  if (cell.middle) {
    const contentHeight = measureCell(doc, cell, width) - PAD * 2;
    cursor = y + Math.max(PAD, (height - contentHeight) / 2);
  }

  if (cell.label) {
    doc
      .font(FONT.bold)
      .fontSize(size)
      .fillColor(DOC_COLORS.caption)
      .text(cell.label, x + PAD, cursor, { width: inner, align });
    cursor = doc.y + 1;
  }

  if (lines.length > 0) {
    doc
      .font(cell.bold ? FONT.bold : FONT.regular)
      .fontSize(size)
      .fillColor(cell.color ?? DOC_COLORS.value);
    for (const line of lines) {
      doc.text(line, x + PAD, cursor, { width: inner, align });
      cursor = doc.y;
    }
  }
}

/**
 * A row of bordered cells. Returns the Y below it.
 *
 * `width` fractions come from the merged ranges in the master sheet: a left half
 * beside two right quarters is `[0.5, 0.25, 0.25]`.
 */
export function bandRow(doc: Doc, y: number, cells: Cell[]): number {
  const widths = resolveWidths(
    cells.map((c) => c.width),
    LAYOUT.width
  );
  const height = Math.max(...cells.map((c, i) => measureCell(doc, c, widths[i])));

  let x = LAYOUT.left;
  cells.forEach((cell, i) => {
    paintCell(doc, cell, x, y, widths[i], height);
    x += widths[i];
  });

  return y + height;
}

/** Normalise a side into a stack of rows. */
function asRows(side: Side): Cell[][] {
  return Array.isArray(side) ? side : [[{ ...side, width: 1 }]];
}

/** Row heights for one side of a split, at a given side width. */
function measureRows(doc: Doc, rows: Cell[][], width: number): number[] {
  return rows.map((row) => {
    const widths = resolveWidths(
      row.map((c) => c.width),
      width
    );
    return Math.max(...row.map((c, i) => measureCell(doc, c, widths[i])));
  });
}

/** Paint a stack of rows into a column, given per-row heights. */
function paintRows(doc: Doc, rows: Cell[][], x0: number, y0: number, width: number, heights: number[]) {
  let y = y0;
  rows.forEach((row, r) => {
    const widths = resolveWidths(
      row.map((c) => c.width),
      width
    );
    let x = x0;
    row.forEach((cell, i) => {
      paintCell(doc, cell, x, y, widths[i], heights[r]);
      x += widths[i];
    });
    y += heights[r];
  });
}

/**
 * Two columns that may each contain a different number of rows.
 *
 * This is the shape of every export document header: the exporter's address
 * occupies A2:B4 while the right half carries Invoice No / Date above Buyer's
 * Order No / IEC No. A plain row cannot express it, because one side spans
 * several rows of the other. The quotation's payment-terms box is the mirror
 * image, so either side may be the tall one.
 *
 * The shorter column is grown to match the taller so the frame has no ragged
 * internal edge; the extra height goes to that column's last row, which is where
 * a continuation of an address or terms would fall anyway.
 *
 * Widths inside each side are fractions OF THAT SIDE, not of the page, so a
 * two-cell right column is `[0.5, 0.5]` however wide the left column is.
 */
export function splitRow(
  doc: Doc,
  y: number,
  leftFraction: number,
  leftSide: Side,
  rightSide: Side
): number {
  const leftWidth = Math.round(leftFraction * LAYOUT.width);
  const rightWidth = LAYOUT.width - leftWidth;

  const leftRows = asRows(leftSide);
  const rightRows = asRows(rightSide);

  const leftHeights = measureRows(doc, leftRows, leftWidth);
  const rightHeights = measureRows(doc, rightRows, rightWidth);

  const leftTotal = leftHeights.reduce((a, b) => a + b, 0);
  const rightTotal = rightHeights.reduce((a, b) => a + b, 0);
  const height = Math.max(leftTotal, rightTotal);

  if (height > leftTotal) leftHeights[leftHeights.length - 1] += height - leftTotal;
  if (height > rightTotal) rightHeights[rightHeights.length - 1] += height - rightTotal;

  paintRows(doc, leftRows, LAYOUT.left, y, leftWidth, leftHeights);
  paintRows(doc, rightRows, LAYOUT.left + leftWidth, y, rightWidth, rightHeights);

  return y + height;
}

/**
 * A full-width bordered strip: the document title, the "PRODUCT DISCRIPTION"
 * heading, and the "NOT FOR SALE" stamp.
 *
 * `insetLeft` reserves space at the left of the strip - the title row uses it so
 * the centred heading is centred in the space beside the logo rather than
 * underneath it.
 */
export function bannerRow(
  doc: Doc,
  y: number,
  text: string,
  opts: {
    fontSize?: number;
    fill?: string;
    minHeight?: number;
    color?: string;
    insetLeft?: number;
  } = {}
): number {
  const size = opts.fontSize ?? 12;
  const inset = opts.insetLeft ?? 0;
  const inner = LAYOUT.width - inset - PAD * 2;

  doc.font(FONT.bold).fontSize(size);
  const textHeight = doc.heightOfString(text, { width: inner });
  const height = Math.max(opts.minHeight ?? 0, textHeight + PAD * 2);

  if (opts.fill) {
    doc.fillColor(opts.fill).rect(LAYOUT.left, y, LAYOUT.width, height).fill();
  }

  doc.strokeColor(DOC_COLORS.border).lineWidth(0.7).rect(LAYOUT.left, y, LAYOUT.width, height).stroke();

  doc
    .font(FONT.bold)
    .fontSize(size)
    .fillColor(opts.color ?? DOC_COLORS.value)
    .text(text, LAYOUT.left + inset + PAD, y + (height - textHeight) / 2, {
      width: inner,
      align: 'center',
    });

  return y + height;
}

/** Column header strip of an item table. */
export function tableHeader(doc: Doc, y: number, columns: Column[]): number {
  const widths = resolveWidths(
    columns.map((c) => c.width),
    LAYOUT.width
  );
  const cells: Cell[] = columns.map((c, i) => ({
    width: widths[i] / LAYOUT.width,
    value: c.header,
    align: 'center',
    bold: true,
    fontSize: 8,
    minHeight: 24,
    middle: true,
  }));

  const height = Math.max(...cells.map((c, i) => measureCell(doc, c, widths[i])));
  // Tint first, so the borders drawn by bandRow sit on top of it.
  doc.fillColor(DOC_COLORS.headFill).rect(LAYOUT.left, y, LAYOUT.width, height).fill();
  return bandRow(doc, y, cells);
}

/**
 * One item row, values positional against `columns`.
 *
 * Starts a new page when the row would cross into the footer, redrawing the
 * column header there - a continuation page of unlabelled figures is not
 * readable, and an export document is routinely checked page by page.
 */
export function tableRow(
  doc: Doc,
  y: number,
  columns: Column[],
  values: string[],
  opts: { minHeight?: number; bold?: boolean } = {}
): number {
  const widths = resolveWidths(
    columns.map((c) => c.width),
    LAYOUT.width
  );
  const cells: Cell[] = columns.map((c, i) => ({
    width: widths[i] / LAYOUT.width,
    value: values[i] ?? '',
    align: c.align ?? 'left',
    fontSize: 8,
    minHeight: opts.minHeight ?? 18,
    bold: opts.bold,
    middle: true,
  }));

  const height = Math.max(...cells.map((c, i) => measureCell(doc, c, widths[i])));

  if (y + height > LAYOUT.bottom) {
    doc.addPage();
    y = tableHeader(doc, LAYOUT.continuationTop, columns);
  }

  return bandRow(doc, y, cells);
}

/**
 * Pad an item table out to a minimum depth with empty bordered rows.
 *
 * The master sheets reserve a fixed block of item rows (rows 10 to 18), so a
 * two-line invoice still has a table of the expected depth instead of the totals
 * riding up under the header. Purely visual: these rows carry no data, and none
 * are added if the page is already full.
 */
export function tableFiller(doc: Doc, y: number, columns: Column[], rowsToAdd: number): number {
  const blanks = columns.map(() => '');
  for (let i = 0; i < rowsToAdd; i += 1) {
    if (y + 18 > LAYOUT.bottom) return y;
    y = tableRow(doc, y, columns, blanks);
  }
  return y;
}

/** Start a new page when less than `needed` points remain before the footer. */
export function ensureRoom(doc: Doc, y: number, needed: number): number {
  if (y + needed <= LAYOUT.bottom) return y;
  doc.addPage();
  return LAYOUT.continuationTop;
}

// ---------------------------------------------------------------------------
// Amount in words
// ---------------------------------------------------------------------------

const ONES = [
  '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN',
  'EIGHTEEN', 'NINETEEN',
];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

function under1000(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const o = ONES[n % 10];
    return o ? `${t} ${o}` : t;
  }
  const h = `${ONES[Math.floor(n / 100)]} HUNDRED`;
  const rest = under1000(n % 100);
  return rest ? `${h} ${rest}` : h;
}

/**
 * A number in words on the international scale (thousand / million / billion).
 *
 * Deliberately not the Indian lakh-crore scale: these documents are read abroad
 * by buyers and by banks handling the LC, and the master draft itself reads
 * "USD FIVE THOUSAND NINE HUNDRED ONLY". An amount in words saying "lakh" invites
 * a documentary discrepancy.
 */
export function numberToWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return 'ZERO';

  const scales: [number, string][] = [
    [1_000_000_000, 'BILLION'],
    [1_000_000, 'MILLION'],
    [1_000, 'THOUSAND'],
  ];

  let remaining = n;
  const parts: string[] = [];

  for (const [scale, name] of scales) {
    if (remaining >= scale) {
      parts.push(`${under1000(Math.floor(remaining / scale))} ${name}`);
      remaining %= scale;
    }
  }

  if (remaining > 0) parts.push(under1000(remaining));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Minor unit name, for the fractional part of an amount in words.
 *
 * Only the currencies this exporter is likely to invoice in are named; anything
 * else falls back to "CENTS", which is the convention on an export document for a
 * decimal currency and is understood by any bank that reads one.
 */
const MINOR_UNITS: Record<string, string> = {
  INR: 'PAISE',
  USD: 'CENTS',
  EUR: 'CENTS',
  GBP: 'PENCE',
  AED: 'FILS',
  SAR: 'HALALA',
  AUD: 'CENTS',
  CAD: 'CENTS',
  SGD: 'CENTS',
  JPY: 'SEN',
};

/** "USD FIVE THOUSAND NINE HUNDRED ONLY". */
export function amountInWords(value: number, currencyCode: string): string {
  const amount = Number(value) || 0;
  const whole = Math.floor(Math.abs(amount));
  // Rounded rather than truncated: 5899.999 prints as 5,900.00 in figures, and
  // words reading "EIGHT HUNDRED NINETY NINE" against that is a discrepancy.
  const fraction = Math.round((Math.abs(amount) - whole) * 100);
  const minor = MINOR_UNITS[currencyCode.toUpperCase()] ?? 'CENTS';

  if (fraction === 0) return `${currencyCode} ${numberToWords(whole)} ONLY`;
  // A fraction that rounded up to 100 is a whole unit.
  if (fraction === 100) return `${currencyCode} ${numberToWords(whole + 1)} ONLY`;
  return `${currencyCode} ${numberToWords(whole)} AND ${numberToWords(fraction)} ${minor} ONLY`;
}
