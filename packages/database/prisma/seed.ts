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
  //
  // No exchange rate here on purpose. Every amount in the database is INR; a
  // currency and a rate are chosen when a quotation or invoice PDF is generated
  // and recorded on that document. A single mutable rate here used to re-price
  // every historical total whenever it was edited.
  const currencies = [
    { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'GBP', name: 'British Pound', symbol: '£' },
    { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  ];

  for (const currency of currencies) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: { name: currency.name, symbol: currency.symbol },
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

  // Seed Ports - Major Indian and International Ports
  // First get country IDs
  const india = await prisma.country.findUnique({ where: { code: 'IN' } });
  const uae = await prisma.country.findUnique({ where: { code: 'AE' } });
  const usa = await prisma.country.findUnique({ where: { code: 'US' } });
  const uk = await prisma.country.findUnique({ where: { code: 'GB' } });
  const china = await prisma.country.findUnique({ where: { code: 'CN' } });
  const singapore = await prisma.country.findUnique({ where: { code: 'SG' } });
  const germany = await prisma.country.findUnique({ where: { code: 'DE' } });

  const ports = [
    // Indian Sea Ports
    { code: 'INMUN', name: 'Mundra', type: 'SEA', countryId: india?.id },
    { code: 'INNSA', name: 'Nhava Sheva (JNPT)', type: 'SEA', countryId: india?.id },
    { code: 'INPAV', name: 'Pipavav', type: 'SEA', countryId: india?.id },
    { code: 'INHZA', name: 'Hazira', type: 'SEA', countryId: india?.id },
    { code: 'INKTP', name: 'Kandla', type: 'SEA', countryId: india?.id },
    { code: 'INMAA', name: 'Chennai', type: 'SEA', countryId: india?.id },
    { code: 'INTUT', name: 'Tuticorin', type: 'SEA', countryId: india?.id },
    { code: 'INCOK', name: 'Cochin', type: 'SEA', countryId: india?.id },
    { code: 'INBLR', name: 'Bangalore ICD', type: 'LAND', countryId: india?.id },
    // Indian Air Ports
    { code: 'INAMD', name: 'Ahmedabad Airport', type: 'AIR', countryId: india?.id },
    { code: 'INDEL', name: 'Delhi Airport', type: 'AIR', countryId: india?.id },
    { code: 'INBOM', name: 'Mumbai Airport', type: 'AIR', countryId: india?.id },
    // UAE Ports
    { code: 'AEJEA', name: 'Jebel Ali', type: 'SEA', countryId: uae?.id },
    { code: 'AEDXB', name: 'Dubai', type: 'SEA', countryId: uae?.id },
    { code: 'AEAUH', name: 'Abu Dhabi', type: 'SEA', countryId: uae?.id },
    // USA Ports
    { code: 'USNYC', name: 'New York', type: 'SEA', countryId: usa?.id },
    { code: 'USLAX', name: 'Los Angeles', type: 'SEA', countryId: usa?.id },
    { code: 'USHOU', name: 'Houston', type: 'SEA', countryId: usa?.id },
    // UK Ports
    { code: 'GBFXT', name: 'Felixstowe', type: 'SEA', countryId: uk?.id },
    { code: 'GBSOU', name: 'Southampton', type: 'SEA', countryId: uk?.id },
    { code: 'GBLGP', name: 'London Gateway', type: 'SEA', countryId: uk?.id },
    // China Ports
    { code: 'CNSHA', name: 'Shanghai', type: 'SEA', countryId: china?.id },
    { code: 'CNSZX', name: 'Shenzhen', type: 'SEA', countryId: china?.id },
    { code: 'CNNGB', name: 'Ningbo', type: 'SEA', countryId: china?.id },
    // Singapore
    { code: 'SGSIN', name: 'Singapore', type: 'SEA', countryId: singapore?.id },
    // Germany
    { code: 'DEHAM', name: 'Hamburg', type: 'SEA', countryId: germany?.id },
    { code: 'DEBRV', name: 'Bremerhaven', type: 'SEA', countryId: germany?.id },
  ];

  for (const port of ports) {
    if (port.countryId) {
      await prisma.port.upsert({
        where: { code: port.code },
        update: { name: port.name, type: port.type },
        create: port as any,
      });
    }
  }
  console.log('✅ Seeded ports');

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
