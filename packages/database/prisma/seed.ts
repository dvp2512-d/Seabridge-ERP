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

  // Seed Pricing Parameters - the components that build up a quotation line
  // price. These are defaults only; they can be added to, renamed, reordered or
  // deactivated from Settings without affecting quotations already created.
  // calcType meaning:
  //   PER_UNIT           - the value is a rate, multiplied by the line quantity
  //   FIXED              - the value IS the total for that component on the line
  //   PERCENT_OF_PRODUCT - % of the product (supplier) price
  //   PERCENT_OF_COST    - % of all cost components
  // Additional costs default to FIXED so you enter the total for the component,
  // not a per-unit rate. Any row can still be switched to per unit on the line.
  const pricingParameters = [
    { name: 'Product Price (Supplier)', sortOrder: 1, calcType: 'PER_UNIT',           isMargin: false, isProductPrice: true, description: 'Supplier rate per unit, multiplied by quantity' },
    { name: 'Packaging & Processing',   sortOrder: 2, calcType: 'FIXED',              isMargin: false, description: 'Total packing, processing and handling cost for this line' },
    { name: 'Our Margin',               sortOrder: 3, calcType: 'PERCENT_OF_PRODUCT', isMargin: true,  description: 'Profit, as a percentage of the product (supplier) price', defaultValue: 15 },
    { name: 'CHA / Customs',            sortOrder: 4, calcType: 'FIXED',              isMargin: false, description: 'Total customs house agent and clearance charges' },
    { name: 'Local Transportation',     sortOrder: 5, calcType: 'FIXED',              isMargin: false, description: 'Total factory or warehouse to port cost' },
    { name: 'Transportation (Air / Sea / Road)', sortOrder: 6, calcType: 'FIXED',     isMargin: false, description: 'Total main freight cost' },
    { name: 'Insurance',                sortOrder: 7, calcType: 'PERCENT_OF_COST',    isMargin: false, description: 'Cargo insurance, as a percentage of total cost', defaultValue: 0.5 },
    { name: 'Inspection',               sortOrder: 8, calcType: 'FIXED',              isMargin: false, description: 'Total third party inspection or certification cost' },
    { name: 'Commission',               sortOrder: 9, calcType: 'FIXED',              isMargin: false, description: 'Total agent or broker commission' },
    { name: 'Other',                    sortOrder: 10, calcType: 'FIXED',             isMargin: false, description: 'Any other total cost for this line' },
  ] as const;

  for (const parameter of pricingParameters) {
    await prisma.pricingParameter.upsert({
      where: { name: parameter.name },
      // Keep defaults in step with the code on re-seed.
      update: {
        calcType: parameter.calcType as any,
        isMargin: parameter.isMargin,
        isProductPrice: (parameter as any).isProductPrice ?? false,
        sortOrder: parameter.sortOrder,
      },
      create: parameter as any,
    });
  }
  console.log('✅ Seeded pricing parameters');

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
