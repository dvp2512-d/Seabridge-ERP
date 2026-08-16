import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const passwordHash = await bcrypt.hash('admin123', 12);
  
  const founder = await prisma.user.upsert({
    where: { email: 'founder@seabridge.com' },
    update: {},
    create: {
      email: 'founder@seabridge.com',
      passwordHash,
      firstName: 'Dhruvil',
      lastName: 'Patel',
      role: 'FOUNDER',
      status: 'ACTIVE',
    },
  });
  console.log('✅ Created founder user:', founder.email);

  // Create sample users
  const salesUser = await prisma.user.upsert({
    where: { email: 'hiren@seabridge.com' },
    update: {},
    create: {
      email: 'hiren@seabridge.com',
      passwordHash,
      firstName: 'Hiren',
      lastName: 'Shah',
      role: 'SALES',
      status: 'ACTIVE',
    },
  });
  console.log('✅ Created sales user:', salesUser.email);

  // Seed Countries
  const countries = [
    { code: 'US', name: 'United States', region: 'North America' },
    { code: 'GB', name: 'United Kingdom', region: 'Europe' },
    { code: 'DE', name: 'Germany', region: 'Europe' },
    { code: 'FR', name: 'France', region: 'Europe' },
    { code: 'IN', name: 'India', region: 'Asia' },
    { code: 'CN', name: 'China', region: 'Asia' },
    { code: 'JP', name: 'Japan', region: 'Asia' },
    { code: 'AE', name: 'United Arab Emirates', region: 'Middle East' },
    { code: 'SA', name: 'Saudi Arabia', region: 'Middle East' },
    { code: 'AU', name: 'Australia', region: 'Oceania' },
    { code: 'BR', name: 'Brazil', region: 'South America' },
    { code: 'SG', name: 'Singapore', region: 'Asia' },
  ];

  for (const country of countries) {
    await prisma.country.upsert({
      where: { code: country.code },
      update: {},
      create: country,
    });
  }
  console.log('✅ Seeded countries');

  // Seed Currencies
  const currencies = [
    { code: 'USD', name: 'US Dollar', symbol: '$', exchangeRate: 1 },
    { code: 'EUR', name: 'Euro', symbol: '€', exchangeRate: 0.92 },
    { code: 'GBP', name: 'British Pound', symbol: '£', exchangeRate: 0.79 },
    { code: 'INR', name: 'Indian Rupee', symbol: '₹', exchangeRate: 83.12 },
    { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', exchangeRate: 3.67 },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥', exchangeRate: 149.50 },
  ];

  for (const currency of currencies) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: {},
      create: currency,
    });
  }
  console.log('✅ Seeded currencies');

  // Seed Incoterms
  const incoterms = [
    { code: 'EXW', name: 'Ex Works', description: 'Seller makes goods available at their premises' },
    { code: 'FOB', name: 'Free on Board', description: 'Seller delivers goods on board the vessel' },
    { code: 'CIF', name: 'Cost, Insurance & Freight', description: 'Seller pays costs and freight to destination port' },
    { code: 'CFR', name: 'Cost & Freight', description: 'Seller pays costs and freight to destination port' },
    { code: 'DDP', name: 'Delivered Duty Paid', description: 'Seller delivers goods cleared for import' },
    { code: 'DAP', name: 'Delivered at Place', description: 'Seller delivers goods to named place' },
  ];

  for (const incoterm of incoterms) {
    await prisma.incoterm.upsert({
      where: { code: incoterm.code },
      update: {},
      create: incoterm,
    });
  }
  console.log('✅ Seeded incoterms');

  // Seed Product Categories
  const categories = [
    { name: 'Spices', description: 'Culinary spices and seasonings' },
    { name: 'Grains & Pulses', description: 'Rice, wheat, lentils, and beans' },
    { name: 'Nuts & Dried Fruits', description: 'Cashews, almonds, raisins' },
    { name: 'Tea & Coffee', description: 'Tea leaves and coffee beans' },
    { name: 'Textiles', description: 'Fabrics and garments' },
  ];

  for (const category of categories) {
    await prisma.productCategory.upsert({
      where: { name: category.name },
      update: {},
      create: category,
    });
  }
  console.log('✅ Seeded product categories');

  // Seed Number Sequences
  const sequences = [
    { entityType: 'BUYER', prefix: 'BYR', currentNo: 0, padLength: 5 },
    { entityType: 'PRODUCT', prefix: 'PRD', currentNo: 0, padLength: 5 },
    { entityType: 'SUPPLIER', prefix: 'SUP', currentNo: 0, padLength: 5 },
    { entityType: 'CHA', prefix: 'CHA', currentNo: 0, padLength: 5 },
    { entityType: 'TRANSPORTER', prefix: 'TRN', currentNo: 0, padLength: 5 },
    { entityType: 'INQUIRY', prefix: 'INQ', currentNo: 0, padLength: 5 },
    { entityType: 'QUOTATION', prefix: 'QT', currentNo: 0, padLength: 5 },
    { entityType: 'ORDER', prefix: 'ORD', currentNo: 0, padLength: 5 },
    { entityType: 'INVOICE', prefix: 'INV', currentNo: 0, padLength: 5 },
    { entityType: 'SHIPMENT', prefix: 'SHP', currentNo: 0, padLength: 5 },
    { entityType: 'PROCUREMENT', prefix: 'PO', currentNo: 0, padLength: 5 },
    { entityType: 'PAYMENT', prefix: 'PAY', currentNo: 0, padLength: 5 },
  ];

  for (const seq of sequences) {
    await prisma.numberSequence.upsert({
      where: { entityType: seq.entityType },
      update: {},
      create: seq,
    });
  }
  console.log('✅ Seeded number sequences');

  // Company Profile - the Exporter block, bank details and standard wording
  // printed on every outgoing document. Values taken from MASTER DRAFT.xlsx.
  // Only created when absent, so later edits in Settings survive a re-seed.
  const existingProfile = await prisma.companyProfile.findFirst();
  if (!existingProfile) {
    await prisma.companyProfile.create({
      data: {
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
          'Goods supplied shall comply with the applicable food safety regulations of the destination country and relevant international food safety standards.',
          "Inspection will be conducted at seller's premises. Third-party inspection if required will be borne by buyer.",
          'Seller shall not be liable for delay or non-performance due to circumstances beyond control such as natural calamities, war, strike, government restrictions, etc.',
          'All disputes shall be subject to Ahmedabad (Gujarat) jurisdiction only.',
        ].join('\n'),
        invoiceDeclaration:
          'We declare that this Invoice shows the actual Price of goods described and that all particulars are true and correct.',
      },
    });
    console.log('✅ Seeded company profile (VISION LIMELITE)');
  } else {
    console.log('ℹ️  Company profile already present, left unchanged');
  }

  console.log('🎉 Database seeding completed!');
  console.log('\n📋 Login credentials:');
  console.log('   Email: founder@seabridge.com');
  console.log('   Password: admin123');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
