import PDFDocument from 'pdfkit';
import { calculateInclusiveUnitPrices } from './inclusivePricing';

// SeaBridge brand colors
const COLORS = {
  navy: '#1e3a5f',
  gold: '#c9a227',
  gray: '#6b7280',
  lightGray: '#f3f4f6',
};

const PAGE = {
  left: 50,
  right: 562,
  width: 512,
  /** Content must stop above this so it never collides with the footer. */
  contentBottom: 720,
  /** Y position where content starts on a continuation page. */
  continuationTop: 60,
};

const FOOTER_TEXT =
  'Thank you for your business! | SeaBridge Exports | www.seabridgeexports.com';

type Doc = PDFKit.PDFDocument;

/**
 * Draw the footer on the current page.
 *
 * The footer sits below the normal content area, so the bottom margin is
 * temporarily removed. Without this PDFKit treats the write as content
 * overflow, auto-appends a page, and the `pageAdded` hook recurses forever.
 * The text cursor is restored so absolute-positioned content is unaffected.
 */
function drawFooter(doc: Doc) {
  const originalBottomMargin = doc.page.margins.bottom;
  const cursorX = doc.x;
  const cursorY = doc.y;

  doc.page.margins.bottom = 0;

  doc
    .fillColor(COLORS.gray)
    .fontSize(8)
    .text(FOOTER_TEXT, PAGE.left, doc.page.height - 40, {
      align: 'center',
      width: PAGE.width,
      lineBreak: false,
    });

  doc.page.margins.bottom = originalBottomMargin;
  doc.x = cursorX;
  doc.y = cursorY;
}

/**
 * Create a document that automatically footers every page, including pages
 * added part-way through a long item list.
 */
function createDocument(): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({ margin: 50, bufferPages: true });
  const chunks: Buffer[] = [];

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Footer every page that gets added from here on.
  doc.on('pageAdded', () => drawFooter(doc));
  // ...and the first page, which exists before the listener is attached.
  drawFooter(doc);

  return { doc, done };
}

/**
 * Returns a safe Y position for the next row, starting a new page when the
 * current one is full. Without this, long quotations wrote over the footer.
 */
function ensureSpace(doc: Doc, yPos: number, needed = 20): number {
  if (yPos + needed <= PAGE.contentBottom) return yPos;
  doc.addPage();
  return PAGE.continuationTop;
}

/**
 * Prisma returns Decimal objects; normalise before formatting.
 *
 * `decimals` exists because an inclusive unit price may carry more than two
 * decimals. Printing such a price rounded to two would make the row fail the
 * buyer's own multiplication, so it is shown at the precision it was computed at.
 */
function money(value: unknown, symbol: string, decimals = 2): string {
  const n = Number(value ?? 0);
  return `${symbol}${(Number.isFinite(n) ? n : 0).toFixed(decimals)}`;
}

function drawItemsHeader(doc: Doc, yPos: number, columns: [string, number][]): number {
  doc.fillColor(COLORS.navy).rect(PAGE.left, yPos, PAGE.width, 20).fill();
  doc.fillColor('#fff').fontSize(9);
  for (const [label, x] of columns) {
    if (x >= 450) {
      doc.text(label, x, yPos + 6, { align: 'right', width: 100 });
    } else {
      doc.text(label, x, yPos + 6);
    }
  }
  return yPos + 25;
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

/** Convert an INR amount into the document currency. */
function fromINR(amountInINR: unknown, rate: number): number {
  const n = Number(amountInINR ?? 0);
  if (!Number.isFinite(n)) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return n;
  return n / rate;
}

/**
 * The exporter's letterhead.
 *
 * Reads the saved CompanyProfile so documents carry the real legal name, GSTIN and
 * IEC rather than a hardcoded placeholder. Falls back to the product name when no
 * profile has been saved yet, so a document is never blank at the top.
 */
function drawLetterhead(doc: Doc, companyProfile?: any): void {
  doc
    .fillColor(COLORS.navy)
    .fontSize(20)
    .text((companyProfile?.legalName || 'SEABRIDGE EXPORTS').toUpperCase(), PAGE.left, 50, {
      width: 330,
    })
    .fontSize(9)
    .fillColor(COLORS.gray)
    .text(
      [
        companyProfile?.gstNumber && `GSTIN: ${companyProfile.gstNumber}`,
        companyProfile?.iecCode && `IEC: ${companyProfile.iecCode}`,
      ]
        .filter(Boolean)
        .join('    ') || 'Excellence in Global Trade',
      PAGE.left,
      76
    );
}

/**
 * A note stating the currency and rate a document was produced at.
 *
 * Amounts are held in INR, so a foreign-currency document is a conversion. Saying
 * so on the page is what makes the figures auditable: without it, a reader cannot
 * reconcile the document against the books.
 */
function drawRateNote(doc: Doc, yPos: number, code: string, rate: number): number {
  if (rate === 1) return yPos;
  doc
    .fillColor(COLORS.gray)
    .fontSize(8)
    .text(
      `Amounts shown in ${code}, converted at 1 ${code} = INR ${rate.toFixed(4)}.`,
      PAGE.left,
      yPos,
      { width: 500 }
    );
  return yPos + 12;
}

export async function generateQuotationPDF(
  quotation: any,
  options: DocumentRenderOptions = DEFAULT_RENDER
): Promise<Buffer> {
  const { doc, done } = createDocument();
  const { currencyCode, currencySymbol: symbol, rate, companyProfile } = options;
  const isBase = rate === 1;

  // Additional costs are billed to the buyer but belong to the quotation as a
  // whole, and this table has a single total column with no charges line. So the
  // charges are folded into the unit prices, which keeps Qty x Unit Price =
  // Amount on every row and makes the column sum to the grand total.
  //
  // The inputs are converted into the document currency FIRST, so the helper's
  // precision reconciliation happens in the currency the buyer will actually
  // check with a calculator. Converting afterwards would round each figure
  // independently and could leave the rows failing to sum to the total.
  const additionalCostsTotal = fromINR(
    (quotation.costs ?? []).reduce((sum: number, cost: any) => sum + Number(cost.amount ?? 0), 0),
    rate
  );
  const quotationItems: any[] = quotation.items ?? [];
  const pricing = calculateInclusiveUnitPrices(
    quotationItems.map((item: any) => ({
      quantity: Number(item.quantity ?? 0),
      unitPrice: fromINR(item.unitPrice, rate),
    })),
    additionalCostsTotal
  );
  // pricing.lines is built by mapping the items in order, so indexes line up.
  const items = quotationItems.map((item: any, index: number) => ({
    ...item,
    printUnitPrice: pricing.lines[index]?.unitPrice ?? fromINR(item.unitPrice, rate),
    printAmount: pricing.lines[index]?.amount ?? fromINR(item.totalPrice, rate),
    printDecimals: pricing.lines[index]?.decimals ?? 2,
  }));
  const goodsSubtotal = quotationItems.reduce(
    (sum: number, item: any) => sum + fromINR(item.totalPrice, rate),
    0
  );

  try {
    // Header
    drawLetterhead(doc, companyProfile);

    doc
      .fillColor(COLORS.navy)
      .fontSize(16)
      .text('QUOTATION', 400, 50, { align: 'right' })
      .fontSize(11)
      .text(quotation.quotationNumber, 400, 70, { align: 'right' });

    doc
      .strokeColor(COLORS.gold)
      .lineWidth(2)
      .moveTo(PAGE.left, 100)
      .lineTo(PAGE.right, 100)
      .stroke();

    // Meta
    doc
      .fillColor(COLORS.gray)
      .fontSize(10)
      .text('Date:', 400, 115)
      .text('Valid Until:', 400, 130)
      .text('Currency:', 400, 145)
      .text('Incoterm:', 400, 160);

    doc
      .fillColor('#000')
      .text(new Date(quotation.createdAt).toLocaleDateString(), 470, 115)
      .text(new Date(quotation.validUntil).toLocaleDateString(), 470, 130)
      .text(currencyCode, 470, 145)
      .text(quotation.incoterm?.code || 'FOB', 470, 160);

    // Buyer
    doc.fillColor(COLORS.navy).fontSize(11).text('Bill To:', PAGE.left, 115);
    doc
      .fillColor('#000')
      .fontSize(10)
      .text(quotation.buyer?.companyName || '', PAGE.left, 132)
      .text(quotation.buyer?.address || '', PAGE.left, 147)
      .text(
        `${quotation.buyer?.city || ''} ${quotation.buyer?.country?.name || ''}`.trim(),
        PAGE.left,
        162
      );

    // Items table
    let yPos = drawItemsHeader(doc, 200, [
      ['Product', 55],
      ['Qty', 250],
      ['Unit', 300],
      ['Unit Price', 350],
      ['Total', 450],
    ]);

    items.forEach((item: any, index: number) => {
      const startedNewPage = yPos + 20 > PAGE.contentBottom;
      yPos = ensureSpace(doc, yPos, 20);
      if (startedNewPage) {
        yPos = drawItemsHeader(doc, yPos, [
          ['Product', 55],
          ['Qty', 250],
          ['Unit', 300],
          ['Unit Price', 350],
          ['Total', 450],
        ]);
      }

      const bgColor = index % 2 === 0 ? '#fff' : COLORS.lightGray;
      doc.fillColor(bgColor).rect(PAGE.left, yPos - 3, PAGE.width, 18).fill();

      doc
        .fillColor('#000')
        .fontSize(9)
        .text(item.product?.name || '', 55, yPos, { width: 190 })
        .text(String(item.quantity ?? ''), 250, yPos)
        .text(item.unit || 'KG', 300, yPos)
        .text(money(item.printUnitPrice, symbol, item.printDecimals), 350, yPos)
        .text(money(item.printAmount, symbol), 450, yPos, {
          align: 'right',
          width: 100,
        });

      yPos += 20;
    });

    if (items.length === 0) {
      doc.fillColor(COLORS.gray).fontSize(9).text('No items on this quotation.', 55, yPos);
      yPos += 20;
    }

    // Totals
    yPos = ensureSpace(doc, yPos, 80) + 10;
    doc
      .strokeColor(COLORS.gray)
      .lineWidth(0.5)
      .moveTo(350, yPos)
      .lineTo(PAGE.right, yPos)
      .stroke();

    yPos += 10;
    doc.fillColor(COLORS.gray).fontSize(10).text('Subtotal:', 350, yPos);
    doc
      .fillColor('#000')
      .text(money(goodsSubtotal, symbol), 450, yPos, { align: 'right', width: 100 });

    if (additionalCostsTotal > 0) {
      yPos += 18;
      doc.fillColor(COLORS.gray).fontSize(10).text('Additional Charges:', 350, yPos);
      doc
        .fillColor('#000')
        .text(money(additionalCostsTotal, symbol), 450, yPos, { align: 'right', width: 100 });
    }

    yPos += 20;
    doc.fillColor(COLORS.navy).fontSize(11).text('Grand Total:', 350, yPos);
    doc
      .fillColor(COLORS.navy)
      .text(money(pricing.total, symbol), 450, yPos, { align: 'right', width: 100 });

    // Terms
    yPos = ensureSpace(doc, yPos + 40, 60);
    if (quotation.paymentTerms) {
      doc.fillColor(COLORS.gray).fontSize(9).text('Payment Terms:', PAGE.left, yPos);
      doc.fillColor('#000').text(String(quotation.paymentTerms), 130, yPos, { width: 420 });
      yPos += 15;
    }

    if (quotation.deliveryTerms) {
      yPos = ensureSpace(doc, yPos, 30);
      doc.fillColor(COLORS.gray).fontSize(9).text('Delivery Terms:', PAGE.left, yPos);
      doc.fillColor('#000').text(String(quotation.deliveryTerms), 130, yPos, { width: 420 });
      yPos += 15;
    }

    if (quotation.termsConditions) {
      yPos = ensureSpace(doc, yPos + 10, 60);
      doc.fillColor(COLORS.gray).fontSize(9).text('Terms & Conditions:', PAGE.left, yPos);
      doc
        .fillColor('#000')
        .text(String(quotation.termsConditions), PAGE.left, yPos + 14, { width: 500 });
      yPos = doc.y + 10;
    }

    if (quotation.notes) {
      yPos = ensureSpace(doc, yPos + 10, 60);
      doc.fillColor(COLORS.gray).fontSize(9).text('Notes:', PAGE.left, yPos);
      doc.fillColor('#000').text(String(quotation.notes), PAGE.left, yPos + 14, { width: 500 });
      yPos = doc.y + 6;
    }

    yPos = ensureSpace(doc, yPos + 12, 24);
    drawRateNote(doc, yPos, currencyCode, rate);

    doc.end();
  } catch (error) {
    doc.end();
    throw error;
  }

  return done;
}

export async function generateInvoicePDF(
  invoice: any,
  options: DocumentRenderOptions = DEFAULT_RENDER
): Promise<Buffer> {
  const { doc, done } = createDocument();
  const { currencyCode, currencySymbol: symbol, rate, companyProfile } = options;

  try {
    // Header
    drawLetterhead(doc, companyProfile);

    doc
      .fillColor(COLORS.navy)
      .fontSize(16)
      .text(invoice.type === 'PROFORMA' ? 'PROFORMA INVOICE' : 'INVOICE', 380, 50, {
        align: 'right',
        width: 182,
      })
      .fontSize(11)
      .text(invoice.invoiceNumber, 400, 70, { align: 'right' });

    doc
      .strokeColor(COLORS.gold)
      .lineWidth(2)
      .moveTo(PAGE.left, 100)
      .lineTo(PAGE.right, 100)
      .stroke();

    // Meta
    doc
      .fillColor(COLORS.gray)
      .fontSize(10)
      .text('Invoice Date:', 400, 115)
      .text('Due Date:', 400, 130)
      .text('Currency:', 400, 145)
      .text('Status:', 400, 160);

    doc
      .fillColor('#000')
      .text(new Date(invoice.invoiceDate).toLocaleDateString(), 480, 115)
      .text(new Date(invoice.dueDate).toLocaleDateString(), 480, 130)
      .text(currencyCode, 480, 145)
      .text(String(invoice.status ?? ''), 480, 160);

    // Buyer
    doc.fillColor(COLORS.navy).fontSize(11).text('Bill To:', PAGE.left, 115);
    doc
      .fillColor('#000')
      .fontSize(10)
      .text(invoice.buyer?.companyName || '', PAGE.left, 132)
      .text(invoice.buyer?.address || '', PAGE.left, 147)
      .text(
        `${invoice.buyer?.city || ''} ${invoice.buyer?.country?.name || ''}`.trim(),
        PAGE.left,
        162
      );

    doc.fillColor(COLORS.gray).fontSize(10).text('Order Reference:', PAGE.left, 185);
    doc.fillColor('#000').text(invoice.order?.orderNumber || '', 140, 185);

    // Line items - a commercial invoice must itemise the goods, so these come
    // from the linked order rather than only showing a subtotal.
    const columns: [string, number][] = [
      ['Description', 55],
      ['Qty', 250],
      ['Unit', 300],
      ['Unit Price', 350],
      ['Amount', 450],
    ];
    let yPos = drawItemsHeader(doc, 220, columns);

    const items = invoice.order?.items ?? [];
    items.forEach((item: any, index: number) => {
      const needsNewPage = yPos + 20 > PAGE.contentBottom;
      yPos = ensureSpace(doc, yPos, 20);
      if (needsNewPage) yPos = drawItemsHeader(doc, yPos, columns);

      const bgColor = index % 2 === 0 ? '#fff' : COLORS.lightGray;
      doc.fillColor(bgColor).rect(PAGE.left, yPos - 3, PAGE.width, 18).fill();

      doc
        .fillColor('#000')
        .fontSize(9)
        .text(item.product?.name || '', 55, yPos, { width: 190 })
        .text(String(item.quantity ?? ''), 250, yPos)
        .text(item.unit || 'KG', 300, yPos)
        .text(money(fromINR(item.unitPrice, rate), symbol), 350, yPos)
        .text(money(fromINR(item.totalPrice, rate), symbol), 450, yPos, { align: 'right', width: 100 });

      yPos += 20;
    });

    if (items.length === 0) {
      doc
        .fillColor(COLORS.gray)
        .fontSize(9)
        .text('See order for itemised goods.', 55, yPos);
      yPos += 20;
    }

    // Totals
    yPos = ensureSpace(doc, yPos, 120) + 10;
    doc
      .strokeColor(COLORS.gray)
      .lineWidth(0.5)
      .moveTo(350, yPos)
      .lineTo(PAGE.right, yPos)
      .stroke();

    yPos += 10;
    doc.fillColor(COLORS.gray).fontSize(10).text('Subtotal:', 350, yPos);
    doc
      .fillColor('#000')
      .text(money(fromINR(invoice.subtotal, rate), symbol), 450, yPos, { align: 'right', width: 100 });

    if (Number(invoice.taxAmount ?? 0) > 0) {
      yPos += 18;
      doc.fillColor(COLORS.gray).fontSize(10).text('Tax:', 350, yPos);
      doc
        .fillColor('#000')
        .text(money(fromINR(invoice.taxAmount, rate), symbol), 450, yPos, { align: 'right', width: 100 });
    }

    yPos += 22;
    doc.fillColor(COLORS.navy).fontSize(11).text('Total Amount:', 350, yPos);
    doc
      .fillColor(COLORS.navy)
      .text(money(fromINR(invoice.totalAmount, rate), symbol), 450, yPos, { align: 'right', width: 100 });

    yPos += 20;
    doc.fillColor(COLORS.gray).fontSize(10).text('Paid:', 350, yPos);
    doc
      .fillColor('#000')
      .text(money(fromINR(invoice.paidAmount, rate), symbol), 450, yPos, { align: 'right', width: 100 });

    yPos += 18;
    doc.fillColor(COLORS.navy).fontSize(11).text('Balance Due:', 350, yPos);
    doc
      .fillColor(COLORS.navy)
      .text(money(fromINR(invoice.balanceAmount, rate), symbol), 450, yPos, { align: 'right', width: 100 });

    if (invoice.termsConditions) {
      yPos = ensureSpace(doc, yPos + 30, 60);
      doc.fillColor(COLORS.gray).fontSize(9).text('Terms & Conditions:', PAGE.left, yPos);
      doc
        .fillColor('#000')
        .text(String(invoice.termsConditions), PAGE.left, yPos + 14, { width: 500 });
      yPos = doc.y + 6;
    }

    yPos = ensureSpace(doc, yPos + 12, 24);
    drawRateNote(doc, yPos, currencyCode, rate);

    doc.end();
  } catch (error) {
    doc.end();
    throw error;
  }

  return done;
}
