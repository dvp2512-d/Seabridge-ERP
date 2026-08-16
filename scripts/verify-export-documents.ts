/**
 * Generates all five export documents from data mirroring MASTER DRAFT.xlsx so
 * the output can be compared against the spreadsheet side by side.
 *
 * Run: bun scripts/verify-export-documents.ts
 * Output: samples/*.pdf  (gitignored)
 */
import fs from 'fs';
import path from 'path';
import {
  buildQuotationDocument,
  buildCommercialInvoiceDocument,
  buildProformaInvoiceDocument,
  buildSampleInvoiceDocument,
  buildPackingListDocument,
} from '../apps/api/src/services/exportDocuments';
import { amountInWords } from '../apps/api/src/services/exportDocumentService';

const outDir = path.resolve(__dirname, '..', 'samples');
fs.mkdirSync(outDir, { recursive: true });

const company = {
  legalName: 'VISION LIMELITE',
  tradeName: 'SeaBridge Exports',
  addressLine1: 'BH-815, 8th Floor Arved Transcube Plaza, Opp. Metro Station',
  addressLine2: 'Business Hub, Ranip',
  city: 'Ahmedabad',
  state: 'Gujarat',
  postalCode: '380004',
  country: 'INDIA',
  originCountry: 'India',
  gstNumber: '24DUBPP8360J1ZB',
  iecCode: 'DUBPP8360J',
  phone: '(+91) 83476 72514',
  contactPerson: 'Vedant Patel',
  email: 'info@seabridgeexports.com',
  bankName: 'Kotak Mahindra Bank',
  bankBranch: 'Satadhar, Ahmedabad',
  bankAccountNo: '8347672514',
  bankBeneficiary: 'VISION LIMELITE',
  bankSwiftCode: 'KKBKINBBXX',
  bankIfscCode: 'KKBK0002576',
  bankChargesNote: 'ALL BANKING CHARGES OUTSIDE INDIA ARE IN ACCOUNT OF APPLICANT',
  quotationTerms: [
    'Prices quoted are on Basis as per Incoterms',
    'Goods supplied shall comply with the applicable food safety regulations of the destination country.',
    '40 Kgs HDPE Bags with inner liner suitable for export shipment',
    'Shipment within 20 days from the date of receipt of advance payment or operative L/C.',
    'All disputes shall be subject to Ahmedabad (Gujarat) jurisdiction only.',
  ].join('\n'),
  invoiceDeclaration:
    'We declare that this Invoice shows the actual Price of goods described and that all particulars are true and correct.',
};

const buyerDubai = {
  companyName: 'Yamnak Foodstuff Trading LLC',
  address: 'Al Aweer Fruit and Vegetable Central Market, Ras Al Khor',
  city: 'Dubai',
  country: { name: 'UAE' },
  contacts: [{ firstName: 'Hadi', designation: 'Purchasing Manager' }],
};

const buyerItaly = {
  companyName: 'MartinoRossi SpA',
  address: 'Strada Provinciale SP 26, Km 15.100',
  city: '26030 Malagnino',
  state: 'Cremona',
  country: { name: 'Italia' },
  contacts: [
    {
      firstName: 'Luca',
      lastName: 'Meanti',
      designation: 'Purchasing Manager',
      phone: '0372 58131',
      email: 'luca.meanti@martinorossispa.it',
    },
  ],
};

const USD = { code: 'USD', symbol: '$' };

// ---- Quotation: matches the QUOTE FORMATE sheet ----
const quotation = {
  quotationNumber: 'QT-2026-0001',
  createdAt: new Date('2026-08-16'),
  validUntil: new Date('2026-09-15'),
  currency: USD,
  incoterm: { code: 'CIF' },
  buyer: buyerDubai,
  paymentTerms: '40% Advance and 60% on Sight LC.',
  deliveryTerms: 'Nhava Sheva to Jebel Ali',
  subtotal: 15000,
  grandTotal: 15000,
  costs: [],
  items: [
    {
      product: { hsnCode: '10063020', code: 'RICE-1121', name: 'Steam Basmati Rice ( 1121 ) Food Grain' },
      quantity: 100,
      unit: 'Kg',
      unitPrice: 150,
      totalPrice: 15000,
    },
  ],
};

// ---- Order used by the invoices and packing list ----
const order = {
  orderNumber: 'SO-2026-0001',
  poNumber: 'PO-8891',
  orderDate: new Date('2026-08-10'),
  dispatchMethod: 'Sea',
  shipmentType: 'FCL',
  variationPercent: 10,
  buyer: buyerItaly,
  invoices: [{ invoiceNumber: 'INV-2026-0001' }],
  shipments: [
    {
      originPort: { name: 'Ahmedabad' },
      destinationPort: { name: 'Genoa' },
      vesselName: 'MV SEABRIDGE',
      containerType: 'FCL',
    },
  ],
  items: [
    {
      product: { hsnCode: '12119032', code: 'PSY-99', name: 'Psyllium Husk Powder 99% pure 100 Mesh' },
      quantity: 500,
      unit: 'KG',
      unitPrice: 11.8,
      totalPrice: 5900,
      numberOfPackages: 20,
      packageWeight: 25,
      netWeight: 500,
      grossWeight: 520,
    },
  ],
};

const commercialInvoice = {
  invoiceNumber: 'INV-2026-0001',
  invoiceDate: new Date('2026-08-16'),
  type: 'EXPORT',
  currency: USD,
  buyer: buyerItaly,
  order,
  subtotal: 5900,
  taxAmount: 0,
  totalAmount: 5900,
};

const proformaInvoice = {
  ...commercialInvoice,
  invoiceNumber: 'PI-2026-0001',
  type: 'PROFORMA',
  termsConditions: '40% Advance and 60% on Sight LC.',
};

// ---- Sample shipment: air, tiny quantities, no commercial value ----
const sampleOrder = {
  ...order,
  orderNumber: 'SO-2026-0002',
  dispatchMethod: 'Air',
  shipmentType: 'Sample Shipment',
  shipments: [
    { originPort: { name: 'Ahmedabad' }, destinationPort: { name: 'Italia' }, vesselName: '-' },
  ],
  items: [
    {
      product: { hsnCode: '12119032', name: 'Psyllium Husk (Plantago Ovata) Powder 99% pure 100 Mesh' },
      quantity: 0.5,
      unit: 'KG',
      unitPrice: 5,
      totalPrice: 2.5,
      numberOfPackages: 1,
      packageWeight: 0.5,
      netWeight: 0.5,
      grossWeight: 1,
    },
    {
      product: { hsnCode: '12119032', name: 'Psyllium Husk (Plantago Ovata) 99% purity' },
      quantity: 0.5,
      unit: 'KG',
      unitPrice: 5,
      totalPrice: 2.5,
      numberOfPackages: 1,
      packageWeight: 0.5,
      netWeight: 0.5,
      grossWeight: 1,
    },
  ],
};

const sampleInvoice = {
  invoiceNumber: 'SI-2026-0001',
  invoiceDate: new Date('2026-08-16'),
  type: 'SAMPLE',
  currency: USD,
  buyer: buyerItaly,
  order: sampleOrder,
  subtotal: 5,
  taxAmount: 0,
  totalAmount: 5,
};

async function main() {
  // Amount-in-words correctness, since it is printed as a legal figure
  const wordCases: [number, string][] = [
    [5, 'USD FIVE ONLY'],
    [5900, 'USD FIVE THOUSAND NINE HUNDRED ONLY'],
    [15000, 'USD FIFTEEN THOUSAND ONLY'],
    [0, 'USD ZERO ONLY'],
    [1234567, 'USD ONE MILLION TWO HUNDRED THIRTY FOUR THOUSAND FIVE HUNDRED SIXTY SEVEN ONLY'],
    [12.5, 'USD TWELVE AND FIFTY CENTS ONLY'],
  ];

  let failures = 0;
  console.log('--- amount in words ---');
  for (const [amount, expected] of wordCases) {
    const actual = amountInWords(amount, 'USD');
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${amount} -> ${actual}`);
    if (!ok) console.log(`        expected: ${expected}`);
  }

  const docs: [string, Promise<Buffer>][] = [
    ['Quotation', buildQuotationDocument(quotation, company)],
    ['CommercialInvoice', buildCommercialInvoiceDocument(commercialInvoice, company)],
    ['ProformaInvoice', buildProformaInvoiceDocument(proformaInvoice, company)],
    ['SampleInvoice', buildSampleInvoiceDocument(sampleInvoice, company)],
    ['PackingList', buildPackingListDocument(order, company)],
  ];

  console.log('\n--- documents ---');
  for (const [name, promise] of docs) {
    try {
      const buffer = await promise;
      const isPdf = buffer.subarray(0, 5).toString() === '%PDF-';
      const file = path.join(outDir, `${name}.pdf`);
      fs.writeFileSync(file, buffer);
      const ok = isPdf && buffer.length > 1000;
      if (!ok) failures++;
      console.log(
        `  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(18)} ${(buffer.length / 1024).toFixed(0)} kB  -> samples/${name}.pdf`
      );
    } catch (error) {
      failures++;
      console.log(`  FAIL  ${name}: ${(error as Error).message}`);
    }
  }

  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
