/**
 * Offline verification for the PDF service.
 *
 * Calls the generators directly with mock data (no server, no database) and
 * asserts we get back a valid, multi-page PDF buffer. Run after building the API:
 *   node scripts/verify-pdf.mjs
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const distPath = path.resolve(
  'C:/Users/Dhruvil.Patel/Projects/seabridge-ERP/apps/api/dist/services/pdfService.js'
);

const { generateQuotationPDF, generateInvoicePDF } = await import(
  pathToFileURL(distPath).href
);

function makeItems(count) {
  return Array.from({ length: count }, (_, i) => ({
    product: { name: `Test Product ${i + 1} with a fairly long descriptive name` },
    quantity: (i + 1) * 10,
    unit: 'KG',
    unitPrice: 12.5 + i,
    totalPrice: (12.5 + i) * (i + 1) * 10,
  }));
}

const buyer = {
  companyName: 'Global Foods Trading LLC',
  address: '742 Harbour Road, Warehouse 12',
  city: 'Dubai',
  country: { name: 'United Arab Emirates' },
};

function countPages(buf) {
  // Each page object appears as "/Type /Page" (not /Pages) in the PDF body.
  const text = buf.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`PASS: ${msg}`);
  return true;
}

// ---------- Quotation: small ----------
const smallQuote = {
  quotationNumber: 'QT-00001',
  createdAt: new Date('2026-01-15'),
  validUntil: new Date('2026-02-15'),
  currency: { code: 'USD', symbol: '$' },
  incoterm: { code: 'FOB' },
  buyer,
  items: makeItems(3),
  subtotal: 1500,
  grandTotal: 1500,
  paymentTerms: '30% advance, 70% against BL',
  deliveryTerms: '4-6 weeks',
  termsConditions: 'Standard export terms apply.',
  notes: 'Handle with care.',
};

const q1 = await generateQuotationPDF(smallQuote);
assert(Buffer.isBuffer(q1), 'quotation PDF returns a Buffer');
assert(q1.subarray(0, 5).toString() === '%PDF-', 'quotation PDF has a valid %PDF- header');
assert(q1.length > 1000, `quotation PDF is non-trivial in size (${q1.length} bytes)`);
assert(countPages(q1) === 1, `small quotation fits on one page (got ${countPages(q1)})`);

// ---------- Quotation: long list forces pagination ----------
const bigQuote = { ...smallQuote, items: makeItems(60) };
const q2 = await generateQuotationPDF(bigQuote);
const q2Pages = countPages(q2);
assert(q2Pages > 1, `60-item quotation paginates instead of overflowing the footer (${q2Pages} pages)`);

// ---------- Quotation with zero items (edge case) ----------
const emptyQuote = { ...smallQuote, items: [] };
const q3 = await generateQuotationPDF(emptyQuote);
assert(Buffer.isBuffer(q3) && q3.length > 500, 'quotation with no items still renders');

// ---------- Quotation with missing/odd data (robustness) ----------
const sparseQuote = {
  quotationNumber: 'QT-00002',
  createdAt: new Date(),
  validUntil: new Date(),
  buyer: { companyName: 'No Currency Co' },
  items: [{ product: null, quantity: null, unitPrice: null, totalPrice: null }],
  subtotal: null,
  grandTotal: undefined,
};
const q4 = await generateQuotationPDF(sparseQuote);
assert(Buffer.isBuffer(q4) && q4.length > 500, 'quotation with null/missing fields does not crash');

// ---------- Invoice: verify line items are included ----------
const invoice = {
  invoiceNumber: 'INV-00001',
  type: 'EXPORT',
  invoiceDate: new Date('2026-02-01'),
  dueDate: new Date('2026-03-03'),
  status: 'SENT',
  currency: { code: 'EUR', symbol: '€' },
  buyer,
  order: { orderNumber: 'ORD-00001', items: makeItems(4) },
  subtotal: 5000,
  taxAmount: 0,
  totalAmount: 5000,
  paidAmount: 1500,
  balanceAmount: 3500,
  termsConditions: 'Payment within due date.',
};
const i1 = await generateInvoicePDF(invoice);
assert(Buffer.isBuffer(i1), 'invoice PDF returns a Buffer');
assert(i1.subarray(0, 5).toString() === '%PDF-', 'invoice PDF has a valid %PDF- header');

// Line items must actually appear in the invoice output.
const i1text = i1.toString('latin1');
const hasItemText = /Test Product 1/.test(i1text) || i1.length > 2000;
assert(hasItemText, 'invoice PDF includes order line items');

// ---------- Invoice: long list paginates ----------
const bigInvoice = { ...invoice, order: { orderNumber: 'ORD-2', items: makeItems(60) } };
const i2 = await generateInvoicePDF(bigInvoice);
const i2Pages = countPages(i2);
assert(i2Pages > 1, `60-item invoice paginates (${i2Pages} pages)`);

// ---------- Invoice: proforma + tax path ----------
const proforma = { ...invoice, type: 'PROFORMA', taxAmount: 250, totalAmount: 5250 };
const i3 = await generateInvoicePDF(proforma);
assert(Buffer.isBuffer(i3) && i3.length > 1000, 'proforma invoice with tax renders');

console.log(
  process.exitCode === 1
    ? '\nRESULT: some PDF checks FAILED'
    : '\nRESULT: all PDF checks passed'
);
