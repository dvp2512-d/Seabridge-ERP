import PDFDocument from 'pdfkit';

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

/** Prisma returns Decimal objects; normalise before formatting. */
function money(value: unknown, symbol: string): string {
  const n = Number(value ?? 0);
  return `${symbol}${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
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

export async function generateQuotationPDF(quotation: any): Promise<Buffer> {
  const { doc, done } = createDocument();
  const symbol = quotation.currency?.symbol || '$';

  try {
    // Header
    doc
      .fillColor(COLORS.navy)
      .fontSize(24)
      .text('SEABRIDGE EXPORTS', PAGE.left, 50)
      .fontSize(10)
      .fillColor(COLORS.gray)
      .text('Excellence in Global Trade', PAGE.left, 78);

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
      .text(quotation.currency?.code || 'USD', 470, 145)
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

    const items = quotation.items ?? [];

    /**
     * The buyer's document must reconcile: quantity x unit price = line total,
     * and the line totals must add up to the grand total.
     *
     * Additional charges (CHA, freight, insurance...) are recorded against the
     * quotation as a whole, so they are apportioned across the lines in
     * proportion to line value and folded into the unit price. The unit price
     * shown is therefore all-inclusive - the number the buyer actually pays per
     * unit - which is what Grand Total / Quantity gives on a single-line quote.
     */
    const additionalCharges = (quotation.costs ?? []).reduce(
      (sum: number, cost: any) => sum + Number(cost.amount ?? 0),
      0
    );
    const lineSubtotal = items.reduce(
      (sum: number, item: any) => sum + Number(item.totalPrice ?? 0),
      0
    );

    let apportioned = 0;
    const rows = items.map((item: any, index: number) => {
      const lineTotal = Number(item.totalPrice ?? 0);
      const qty = Number(item.quantity ?? 0);
      const isLast = index === items.length - 1;

      // Give the last line whatever is left so the apportionment is exact.
      let share: number;
      if (isLast) {
        share = money(additionalCharges - apportioned);
      } else {
        share = money(
          lineSubtotal > 0
            ? additionalCharges * (lineTotal / lineSubtotal)
            : additionalCharges / Math.max(items.length, 1)
        );
        apportioned += share;
      }

      // Round the unit price first, then derive the total from it, so the
      // multiplication printed on the page is exactly right.
      const unitPrice = qty > 0 ? money((lineTotal + share) / qty) : 0;
      const total = qty > 0 ? money(unitPrice * qty) : money(lineTotal + share);

      return { item, qty, unitPrice, total };
    });

    const documentTotal = money(rows.reduce((sum, r) => sum + r.total, 0));

    rows.forEach(({ item, qty, unitPrice, total }, index) => {
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
        .text(String(qty || ''), 250, yPos)
        .text(item.unit || 'KG', 300, yPos)
        .text(money(unitPrice, symbol), 350, yPos)
        .text(money(total, symbol), 450, yPos, {
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
    yPos = ensureSpace(doc, yPos, 90) + 10;
    doc
      .strokeColor(COLORS.gray)
      .lineWidth(0.5)
      .moveTo(350, yPos)
      .lineTo(PAGE.right, yPos)
      .stroke();

    yPos += 10;
    doc.fillColor(COLORS.navy).fontSize(11).text('Grand Total:', 350, yPos);
    doc
      .fillColor(COLORS.navy)
      .text(money(documentTotal, symbol), 450, yPos, { align: 'right', width: 100 });

    if (additionalCharges > 0) {
      yPos += 16;
      doc
        .fillColor(COLORS.gray)
        .fontSize(8)
        .text(
          'Unit prices are inclusive of all applicable charges.',
          350,
          yPos,
          { align: 'right', width: 200 }
        );
    }

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
    }

    doc.end();
  } catch (error) {
    doc.end();
    throw error;
  }

  return done;
}

export async function generateInvoicePDF(invoice: any): Promise<Buffer> {
  const { doc, done } = createDocument();
  const symbol = invoice.currency?.symbol || '$';

  try {
    // Header
    doc
      .fillColor(COLORS.navy)
      .fontSize(24)
      .text('SEABRIDGE EXPORTS', PAGE.left, 50)
      .fontSize(10)
      .fillColor(COLORS.gray)
      .text('Excellence in Global Trade', PAGE.left, 78);

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
      .text(invoice.currency?.code || 'USD', 480, 145)
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
        .text(money(item.unitPrice, symbol), 350, yPos)
        .text(money(item.totalPrice, symbol), 450, yPos, { align: 'right', width: 100 });

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
      .text(money(invoice.subtotal, symbol), 450, yPos, { align: 'right', width: 100 });

    if (Number(invoice.taxAmount ?? 0) > 0) {
      yPos += 18;
      doc.fillColor(COLORS.gray).fontSize(10).text('Tax:', 350, yPos);
      doc
        .fillColor('#000')
        .text(money(invoice.taxAmount, symbol), 450, yPos, { align: 'right', width: 100 });
    }

    yPos += 22;
    doc.fillColor(COLORS.navy).fontSize(11).text('Total Amount:', 350, yPos);
    doc
      .fillColor(COLORS.navy)
      .text(money(invoice.totalAmount, symbol), 450, yPos, { align: 'right', width: 100 });

    yPos += 20;
    doc.fillColor(COLORS.gray).fontSize(10).text('Paid:', 350, yPos);
    doc
      .fillColor('#000')
      .text(money(invoice.paidAmount, symbol), 450, yPos, { align: 'right', width: 100 });

    yPos += 18;
    doc.fillColor(COLORS.navy).fontSize(11).text('Balance Due:', 350, yPos);
    doc
      .fillColor(COLORS.navy)
      .text(money(invoice.balanceAmount, symbol), 450, yPos, { align: 'right', width: 100 });

    if (invoice.termsConditions) {
      yPos = ensureSpace(doc, yPos + 30, 60);
      doc.fillColor(COLORS.gray).fontSize(9).text('Terms & Conditions:', PAGE.left, yPos);
      doc
        .fillColor('#000')
        .text(String(invoice.termsConditions), PAGE.left, yPos + 14, { width: 500 });
    }

    doc.end();
  } catch (error) {
    doc.end();
    throw error;
  }

  return done;
}
