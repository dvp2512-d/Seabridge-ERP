/**
 * Verifies the CONTENT of the generated documents, not just that a PDF was
 * produced. Decompresses the PDF's page streams and pulls out the text-showing
 * operators, then asserts each document carries the fields its template
 * requires - and, importantly, that it does NOT carry fields belonging to a
 * different document (e.g. bank details must not appear on a Sample Invoice).
 *
 * Run: bun scripts/verify-document-content.ts   (after verify-export-documents.ts)
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const samples = path.resolve(__dirname, '..', 'samples');

/** Pull readable text out of a PDFKit-generated PDF. */
function extractText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const out: string[] = [];
  let streamsSeen = 0;
  let streamsInflated = 0;

  // Page content is Flate-compressed between stream/endstream.
  const re = /stream[\r\n]{1,2}([\s\S]*?)[\r\n]{0,2}endstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    streamsSeen++;
    const chunk = Buffer.from(m[1], 'latin1');

    let text = '';
    // Z_SYNC_FLUSH tolerates a stream whose final bytes were trimmed by the
    // regex boundary, which strict inflateSync rejects outright.
    for (const opts of [
      { finishFlush: zlib.constants.Z_SYNC_FLUSH },
      { finishFlush: zlib.constants.Z_SYNC_FLUSH, windowBits: -15 },
    ]) {
      try {
        text = zlib.inflateSync(chunk, opts as zlib.ZlibOptions).toString('latin1');
        break;
      } catch {
        /* try the next strategy */
      }
    }
    // Uncompressed content streams are also valid PDF.
    if (!text && /\)\s*Tj|\]\s*TJ/.test(m[1])) text = m[1];
    if (!text) continue;

    // Skip image data: content streams begin with graphics operators, and
    // decoded images can be tens of megabytes.
    if (!/\bBT\b/.test(text)) continue;
    streamsInflated++;

    // PDFKit writes text either as (literal) or, with embedded fonts, as
    // hex-encoded character codes: [<51> 10 <554f> 40 <54>] TJ  ->  "QUOTATION"
    for (const block of text.matchAll(/\[((?:[^\][]|\\.)*)\]\s*TJ|\((?:\\.|[^()\\])*\)\s*Tj|<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
      const whole = block[0];
      let run = '';
      // literal strings
      for (const t of whole.matchAll(/\(((?:\\.|[^()\\])*)\)/g)) run += unescapePdf(t[1]);
      // hex strings
      for (const h of whole.matchAll(/<([0-9A-Fa-f\s]+)>/g)) run += hexToText(h[1]);
      if (run) out.push(run);
    }
  }

  if (process.env.DEBUG_PDF) {
    console.log(`    [streams: ${streamsSeen} seen, ${streamsInflated} readable, ${out.length} text runs]`);
  }
  return out.join(' ');
}

/** Decode a PDF hex string, e.g. "554f" -> "UO". */
function hexToText(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code >= 32 && code < 255) out += String.fromCharCode(code);
  }
  return out;
}

function unescapePdf(s: string): string {
  return s
    .replace(/\\([nrtbf()\\])/g, (_, c) =>
      ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[c] ?? c
    )
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}

/** Collapse whitespace so assertions are not defeated by line wrapping. */
function normalise(s: string): string {
  return s.replace(/\s+/g, ' ');
}

interface Check {
  file: string;
  /** Substrings that must be present */
  must: string[];
  /** Substrings that must NOT be present */
  mustNot?: string[];
}

const checks: Check[] = [
  {
    file: 'Quotation.pdf',
    must: [
      'QUOTATION',
      'VISION LIMELITE',
      'Yamnak Foodstuff Trading LLC',
      'Quotation No',
      'QT-2026-0001',
      'PRODUCT DESCRIPTION',
      'Product Code',
      'Description of Goods',
      'Unit Type',
      '10063020',
      'Steam Basmati Rice',
      'Terms & Conditions',
      'jurisdiction',
      'USD FIFTEEN THOUSAND ONLY',
      '15,000.00',
    ],
    // A quotation is not an invoice: no bank details, no customs declaration
    mustNot: ['Bank Details', 'NOT FOR SALE', 'Gross Weight'],
  },
  {
    file: 'CommercialInvoice.pdf',
    must: [
      'COMMERCIAL INVOICE',
      'VISION LIMELITE',
      'GST : 24DUBPP8360J1ZB',
      'MartinoRossi SpA',
      'Invoice No',
      'INV-2026-0001',
      "Buyer's Order No",
      'PO-8891',
      'HS Code',
      '12119032',
      'Psyllium Husk Powder',
      'Method Of Dispatch',
      'Sea',
      'Port Of Loading',
      'Ahmedabad',
      'Port Of Discharge',
      'Genoa',
      'Vessel / Flight No',
      'MV SEABRIDGE',
      'Country of Origin',
      'India',
      'Bank Details',
      'KKBKINBBXX',
      'KKBK0002576',
      'BANKING CHARGES OUTSIDE INDIA',
      'USD FIVE THOUSAND NINE HUNDRED ONLY',
      'Total Cartons / Box : 20',
      'Net Weight : 500 KGS',
      'Gross Weight : 520 KGS',
      'Variation % +/- : 10 %',
      'actual Price of goods',
    ],
    mustNot: ['NOT FOR SALE'],
  },
  {
    file: 'ProformaInvoice.pdf',
    must: [
      'PROFORMA INVOICE',
      'PI-2026-0001',
      'Bank Details',
      'Kotak Mahindra Bank',
      'Beneficiary Name : VISION LIMELITE',
      'USD FIVE THOUSAND NINE HUNDRED ONLY',
      'Variation % +/- : 10 %',
      '40% Advance and 60% on Sight LC.',
    ],
    mustNot: ['NOT FOR SALE'],
  },
  {
    file: 'SampleInvoice.pdf',
    must: [
      'SAMPLE INVOICE',
      'SI-2026-0001',
      'Air',
      'Sample Shipment',
      'NOT FOR SALE',
      'VALUE FOR CUSTOMS PURPOSES ONLY',
      'non-hazardous',
      'USD FIVE ONLY',
      'Unit Rate',
      'Plantago Ovata',
    ],
    // Samples are not paid for, so bank details would be misleading
    mustNot: ['Bank Details', 'KKBKINBBXX'],
  },
  {
    file: 'PackingList.pdf',
    must: [
      'PACKING LIST',
      'No. of Packages',
      'Bag / Carton Per KGs',
      'Net Weight',
      'Gross Weight',
      'TOTAL PACKAGES',
      'TOTAL NET WEIGHT (KGS)',
      'TOTAL GROSS WEIGHT (KGS)',
      '12119032',
      'NON-HAZARDOUS',
      'Packing List No',
      'SO-2026-0001',
      'Invoice No',
    ],
    // A packing list must never show prices
    mustNot: ['Rate (USD)', 'Amount in words', 'Bank Details', '11.80'],
  },
];

let failures = 0;
let passes = 0;

for (const check of checks) {
  const file = path.join(samples, check.file);
  if (!fs.existsSync(file)) {
    console.log(`\nFAIL  ${check.file} not found - run verify-export-documents.ts first`);
    failures++;
    continue;
  }

  const text = normalise(extractText(fs.readFileSync(file)));
  console.log(`\n=== ${check.file} (${text.length} chars of text) ===`);

  for (const needle of check.must) {
    const found = text.includes(normalise(needle));
    if (found) passes++;
    else {
      failures++;
      console.log(`  MISSING: "${needle}"`);
    }
  }

  for (const needle of check.mustNot ?? []) {
    const found = text.includes(normalise(needle));
    if (!found) passes++;
    else {
      failures++;
      console.log(`  SHOULD NOT APPEAR: "${needle}"`);
    }
  }

  const missing = check.must.filter((n) => !text.includes(normalise(n))).length;
  const leaked = (check.mustNot ?? []).filter((n) => text.includes(normalise(n))).length;
  if (missing === 0 && leaked === 0) {
    console.log(`  OK - all ${check.must.length} required fields present, ${(check.mustNot ?? []).length} exclusions respected`);
  }
}

console.log(`\n${'-'.repeat(60)}`);
console.log(`${passes} assertions passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
