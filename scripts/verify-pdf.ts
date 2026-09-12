/**
 * Render every export document from mock data, without a database.
 *
 * package.json has always referenced this script; the file was missing, so
 * `npm run verify:pdf` - and therefore `npm run verify` - failed before running
 * anything. It exists to catch the failures that only appear at render time and
 * that a typecheck cannot see: a cell that overflows its box, a totals row that
 * lands on the next page on its own, a field that silently prints "undefined".
 *
 * The mock objects mirror the Prisma shapes the routes pass in - see the `include`
 * blocks in routes/invoices.ts, routes/quotations.ts and routes/orders.ts. Keep
 * them in step with those queries, or this script will pass while the real
 * documents are missing data.
 *
 * Output goes to samples/generated/ so the documents can be opened and compared
 * against MASTER DRAFT .xlsx.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  generateQuotationPDF,
  generateInvoicePDF,
  generatePackingListPDF,
  generatePurchaseOrderPDF,
} from '../apps/api/src/services/pdfService';

const OUT_DIR = path.join(process.cwd(), 'samples', 'generated');

const companyProfile = {
  legalName: 'Vision Limelite',
  tradeName: 'SeaBridge Exports',
  addressLine1: 'BH-815, 8th Floor Arved Transcube Plaza, Opp. Metro Station',
  addressLine2: 'Business Hub, Ranip',
  city: 'Ahmedabad',
  state: 'Gujarat',
  postalCode: '380004',
  country: 'India',
  originCountry: 'India',
  gstNumber: '24DUBPP8360J1ZB',
  iecCode: 'DUBPP8360J',
  phone: '(+91) 83476 72514',
  contactPerson: 'Vedant Patel',
  email: 'info@seabridgeexports.com',
  bankName: 'Kotak Mahindra Bank',
  bankBranch: 'Ranip, Ahmedabad',
  bankAccountNo: '1234567890',
  bankBeneficiary: 'VISION LIMELITE',
  bankSwiftCode: 'KKBKINBB',
  bankIfscCode: 'KKBK0002561',
  quotationTerms:
    'Prices quoted are on FOB basis as per Incoterms 2020.\nGoods comply with applicable food safety regulations.\nInspection at seller premises; third-party inspection at buyer cost.',
};

const buyer = {
  companyName: 'Al Noor Trading LLC',
  address: 'Warehouse 14, Al Quoz Industrial Area 3',
  city: 'Dubai',
  state: 'Dubai',
  postalCode: '00000',
  taxId: '100234567800003',
  country: { name: 'United Arab Emirates' },
};

const products = [
  {
    code: 'PSY-HUSK-99',
    hsnCode: '12119032',
    name: 'Psyllium Husk 99% Purity',
    unit: 'KG',
    packageType: 'BAG',
    packageNetWeight: 25,
    packageGrossWeight: 25.4,
  },
  {
    code: 'PSY-PWD-40',
    hsnCode: '12119099',
    name: 'Psyllium Husk Powder 40 Mesh',
    unit: 'KG',
    packageType: 'BAG',
    packageNetWeight: 25,
    packageGrossWeight: 25.4,
  },
  {
    code: 'CUM-SEED-99',
    hsnCode: '09093121',
    name: 'Cumin Seeds Machine Cleaned 99% Purity, Europe Grade',
    unit: 'KG',
    packageType: 'BAG',
    packageNetWeight: 50,
    packageGrossWeight: 50.6,
  },
];

// Packing figures are declared per line, as the schema stores them.
const orderItems = [
  {
    quantity: 1000,
    unit: 'KG',
    unitPrice: 210.5,
    totalPrice: 210500,
    numberOfPackages: 40,
    packageWeight: 25,
    netWeight: 1000,
    grossWeight: 1016,
    product: products[0],
  },
  {
    quantity: 500,
    unit: 'KG',
    unitPrice: 178.25,
    totalPrice: 89125,
    numberOfPackages: 20,
    packageWeight: 25,
    netWeight: 500,
    grossWeight: 508,
    product: products[1],
  },
  {
    quantity: 2500,
    unit: 'KG',
    unitPrice: 265,
    totalPrice: 662500,
    numberOfPackages: 50,
    // Cartoned for this shipment even though the product default is a bag, which is
    // exactly the case a per-line type exists for.
    packageType: 'CARTON',
    packageWeight: 50,
    netWeight: 2500,
    grossWeight: 2530,
    product: products[2],
  },
];

const order = {
  orderNumber: 'VL/ORD/26-0042',
  poNumber: 'ANT-PO-8891',
  orderDate: new Date('2026-08-20'),
  paymentTerms: '30% advance, balance against BL copy',
  deliveryTerms: 'Delivery within 21 days of order confirmation',
  dispatchMethod: 'SEA',
  shipmentType: 'FCL',
  variationPercent: 10,
  // Goods consigned to one party, invoiced to another - the "Buyer ( If Other than
  // Consinee )" box.
  billToBuyer: {
    companyName: 'Gulf Commodities FZE',
    address: 'Office 1204, JAFZA One Tower A',
    city: 'Jebel Ali Free Zone',
    postalCode: '18500',
    taxId: '100555444300003',
    country: { name: 'United Arab Emirates' },
  },
  // Sibling invoices, so the packing list can name the commercial invoice.
  invoices: [
    { id: 'inv-1', invoiceNumber: 'VL/INV/26-0088', type: 'COMMERCIAL' },
    { id: 'pl-1', invoiceNumber: 'PL-00007', type: 'PACKING_LIST' },
  ],
  incoterm: { code: 'CIF', name: 'Cost, Insurance and Freight' },
  portOfLoading: { name: 'Mundra', code: 'INMUN', type: 'SEA' },
  portOfDischarge: { name: 'Jebel Ali', code: 'AEJEA', type: 'SEA' },
  items: orderItems,
  shipments: [
    {
      vesselName: 'MV Maersk Cabinda',
      containerNumber: 'MRKU 483920-1',
      containerType: '40HC',
      blNumber: 'MAEU2260491',
      originPort: { name: 'Mundra', type: 'SEA' },
      destinationPort: { name: 'Jebel Ali', type: 'SEA' },
    },
  ],
};

function invoice(type: string, invoiceNumber: string) {
  return {
    // Matches the sibling entries on the order, so the packing list can identify
    // itself and name the commercial invoice it accompanies.
    id: type === 'PACKING_LIST' ? 'pl-1' : 'inv-1',
    invoiceNumber,
    type,
    invoiceDate: new Date('2026-09-01'),
    dueDate: new Date('2026-10-01'),
    subtotal: 962125,
    taxAmount: 0,
    totalAmount: 962125,
    termsConditions: 'Payment by irrevocable LC at sight',
    // Only printed on the sample invoice.
    purpose:
      type === 'SAMPLE'
        ? 'Free Sample \u2013 Buyer Evaluation \u2013 No Commercial Value'
        : null,
    buyer,
    order,
  };
}

const quotation = {
  quotationNumber: 'VL/QT/26-0117',
  createdAt: new Date('2026-08-05'),
  validUntil: new Date('2026-09-05'),
  dispatchMethod: 'SEA',
  shipmentType: 'FCL - 40HC',
  paymentTerms: '30% advance against order, 70% against scanned BL',
  inquiry: { inquiryNumber: 'VL/INQ/26-0203' },
  buyer,
  incoterm: { code: 'CIF', name: 'Cost, Insurance and Freight' },
  portOfLoading: { name: 'Mundra', code: 'INMUN', type: 'SEA' },
  portOfDischarge: { name: 'Jebel Ali', code: 'AEJEA', type: 'SEA' },
  items: [
    { quantity: 1000, unit: 'KG', unitPrice: 210.5, totalPrice: 210500, product: products[0] },
    { quantity: 500, unit: 'KG', unitPrice: 178.25, totalPrice: 89125, product: products[1] },
  ],
  // Freight and CHA, folded into the printed unit prices by inclusivePricing.
  costs: [
    { costType: 'FREIGHT', amount: 62000 },
    { costType: 'CHA', amount: 18500 },
  ],
};

const procurement = {
  poNumber: 'VL/PO/26-0311',
  status: 'ORDERED',
  orderDate: new Date('2026-08-22'),
  expectedDate: new Date('2026-09-05'),
  notes: 'Deliver to Mundra ICD. Fumigation certificate required with each lot.',
  // The PO sheet boxes.
  deliveryAddress: 'SeaBridge Warehouse, Plot 42, Mundra Port ICD, Kutch, Gujarat',
  modeOfDelivery: 'Road - Ex-factory pickup',
  paymentMode: '50% advance on PO confirmation, 50% on delivery against COA',
  pickupLocation: 'Factory, Unjha, Mehsana',
  destination: 'Mundra Port ICD',
  packingInstructions: '25kg HDPE bags with inner liner, palletised',
  qualityRequirement:
    'Batch-wise COA required with delivery (purity, swelling index, moisture, microbial parameters)',
  variationPercent: 5,
  // The PO's own lines, at supplier rates with GST. Totals below are what
  // priceProcurementLines computes from them:
  //   1000 x 180.00 = 180,000.00  + 5%  =   9,000.00
  //    500 x 152.00 =  76,000.00  + 5%  =   3,800.00
  //   2500 x 240.00 = 600,000.00  + 12% =  72,000.00
  //   subtotal 856,000.00, tax 84,800.00, total 940,800.00
  items: [
    {
      quantity: 1000,
      unit: 'KG',
      rate: 180,
      taxPercent: 5,
      amount: 180000,
      taxAmount: 9000,
      product: products[0],
    },
    {
      quantity: 500,
      unit: 'KG',
      rate: 152,
      taxPercent: 5,
      amount: 76000,
      taxAmount: 3800,
      product: products[1],
    },
    {
      quantity: 2500,
      unit: 'KG',
      rate: 240,
      taxPercent: 12,
      amount: 600000,
      taxAmount: 72000,
      product: products[2],
    },
  ],
  subtotal: 856000,
  taxAmount: 84800,
  totalAmount: 940800,
  supplier: {
    name: 'Shree Unjha Psyllium Industries',
    address: 'Survey 214, GIDC Phase II, Unjha, Mehsana, Gujarat 384170',
    gstNumber: '24AABCU9603R1ZM',
    contactPerson: 'Rakesh Patel',
    phone: '+91 98250 11223',
    email: 'sales@unjhapsyllium.in',
    country: { name: 'India' },
  },
  order: { orderNumber: 'VL/ORD/26-0042', items: orderItems },
};

/** USD at a rate the operator would type. INR documents use a rate of 1. */
const usd = { currencyCode: 'USD', currencySymbol: '$', rate: 88.4215, companyProfile };
const inr = { currencyCode: 'INR', currencySymbol: '₹', rate: 1, companyProfile };

/**
 * Number of pages in a rendered PDF.
 *
 * Counted from the page objects in the raw file rather than by parsing it
 * properly, which would need a PDF library this project does not depend on. Each
 * document here is meant to fit on one page; a second page means a band grew past
 * the frame, which is the regression most worth catching.
 */
function pageCount(buffer: Buffer): number {
  const matches = buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const documents: [string, Promise<Buffer>][] = [
    ['Quotation.pdf', generateQuotationPDF(quotation, usd)],
    ['Quotation-INR.pdf', generateQuotationPDF(quotation, inr)],
    ['CommercialInvoice.pdf', generateInvoicePDF(invoice('COMMERCIAL', 'VL/INV/26-0088'), usd)],
    ['ProformaInvoice.pdf', generateInvoicePDF(invoice('PROFORMA', 'VL/PI/26-0031'), usd)],
    ['SampleInvoice.pdf', generateInvoicePDF(invoice('SAMPLE', 'VL/SI/26-0007'), usd)],
    ['PackingList.pdf', generatePackingListPDF(invoice('PACKING_LIST', 'PL-00007'), usd)],
    ['PurchaseOrder.pdf', generatePurchaseOrderPDF(procurement, { companyProfile })],
  ];

  // An empty document is the case that used to crash: no items, no shipment, and
  // no company profile saved yet.
  documents.push([
    'CommercialInvoice-empty.pdf',
    generateInvoicePDF(
      {
        invoiceNumber: 'VL/INV/26-0090',
        type: 'COMMERCIAL',
        invoiceDate: new Date('2026-09-11'),
        totalAmount: 0,
        buyer: { companyName: 'Unknown Buyer', country: {} },
        order: { items: [], shipments: [] },
      },
      { currencyCode: 'INR', currencySymbol: '₹', rate: 1 }
    ),
  ]);

  let failed = 0;

  for (const [name, promise] of documents) {
    try {
      const buffer = await promise;
      if (!buffer || buffer.length === 0) throw new Error('empty buffer');
      if (buffer.subarray(0, 4).toString() !== '%PDF') throw new Error('not a PDF');

      const pages = pageCount(buffer);
      if (pages !== 1) {
        throw new Error(`${pages} pages, expected 1 - a band has outgrown the frame`);
      }

      fs.writeFileSync(path.join(OUT_DIR, name), buffer);
      console.log(`  ok    ${name.padEnd(30)} ${pages} page  ${(buffer.length / 1024).toFixed(1)} KB`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL  ${name.padEnd(30)} ${(error as Error).message}`);
    }
  }

  console.log(`\n${documents.length - failed}/${documents.length} documents rendered into ${OUT_DIR}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
