/**
 * Financial calculation tests for SeaBridge ERP.
 *
 * Tests 1-8:  Pure service functions — no HTTP, no mocking.
 * Tests 9-17: Route behaviour — supertest with prisma mocked.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ─── Pure function imports ───────────────────────────────────────────────────

// sumConverted is a pure function exported directly from exchangeRateService.
// The async functions (toBaseCurrency, buildRateMap, etc.) depend on prisma and
// are tested via the route-level integration tests instead.
import { sumConverted } from '../services/exchangeRateService';

// The entire inclusivePricing module is pure — no IO dependencies at all.
import { calculateInclusiveUnitPrices } from '../services/inclusivePricing';

// ─── Mocks for route-level tests ────────────────────────────────────────────

// Mock @seabridge/database before any route imports
vi.mock('@seabridge/database', () => {
  const mockPrisma = {
    user: { findUnique: vi.fn() },
    currency: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    exchangeRate: { findFirst: vi.fn(), findMany: vi.fn() },
    invoice: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    exportOrder: { findUnique: vi.fn() },
    numberSequence: { upsert: vi.fn() },
    payment: { create: vi.fn() },
    buyer: { update: vi.fn() },
    quotation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    companyProfile: { findFirst: vi.fn() },
    inquiry: { update: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  };

  return {
    prisma: mockPrisma,
    Prisma: { QuotationUpdateInput: {} },
    InquiryStage: {},
    UserRole: {
      FOUNDER: 'FOUNDER',
      ADMIN: 'ADMIN',
      SALES: 'SALES',
      OPERATIONS: 'OPERATIONS',
      FINANCE: 'FINANCE',
    },
  };
});

// Mock eventService to prevent side effects
vi.mock('../services/eventService', () => ({
  emitEvent: vi.fn(),
}));

import { prisma } from '@seabridge/database';
import request from 'supertest';
import { createTestJwt } from './setup';

// ─────────────────────────────────────────────────────────────────────────────
// TESTS 1-8: Pure service functions
// ─────────────────────────────────────────────────────────────────────────────

describe('Exchange Rate Service — pure functions', () => {
  // Tests 7-8: sumConverted is a pure function
  describe('sumConverted', () => {
    it('test 7: returns correct total across multiple currencies', () => {
      const rates = new Map<string, number>();
      rates.set('curr-usd', 84.5);   // 1 USD = 84.5 INR
      rates.set('curr-eur', 92.3);   // 1 EUR = 92.3 INR
      rates.set('curr-inr', 1);      // base currency

      const rows = [
        { amount: 1000, currencyId: 'curr-usd' },   // 1000 * 84.5 = 84500
        { amount: 500, currencyId: 'curr-eur' },     // 500 * 92.3 = 46150
        { amount: 10000, currencyId: 'curr-inr' },   // 10000 * 1 = 10000
      ];

      const result = sumConverted(rows, rates);

      expect(result.total).toBe(140650);
      expect(result.convertedCount).toBe(3);
      expect(result.unconvertedCount).toBe(0);
    });

    it('test 8: counts unconverted rows, does not add them to total', () => {
      const rates = new Map<string, number>();
      rates.set('curr-usd', 84.5);

      const rows = [
        { amount: 1000, currencyId: 'curr-usd' },     // converted: 84500
        { amount: 2000, currencyId: 'curr-gbp' },     // no rate → unconverted
        { amount: 500, currencyId: 'curr-unknown' },   // no rate → unconverted
      ];

      const result = sumConverted(rows, rates);

      expect(result.total).toBe(84500);
      expect(result.convertedCount).toBe(1);
      expect(result.unconvertedCount).toBe(2);
    });
  });
});

describe('Exchange Rate Service — async functions via mocked prisma', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: toBaseCurrency converts 1000 USD at rate 84.5 → 84500 INR
  it('test 1: toBaseCurrency converts 1000 USD at rate 84.5 → 84500 INR', async () => {
    // We must re-import because the module uses prisma at top-level
    const { toBaseCurrency } = await import('../services/exchangeRateService');

    const mockPrisma = prisma as any;
    mockPrisma.currency.findFirst.mockResolvedValue({
      id: 'curr-inr',
      code: 'INR',
      symbol: '₹',
      isBaseCurrency: true,
    });
    mockPrisma.exchangeRate.findFirst.mockResolvedValue({
      currency: { code: 'USD' },
      exportRate: 84.5,
      importRate: 85.0,
      source: 'CBIC',
      notificationRef: 'N-01/2026',
      effectiveFrom: new Date('2026-08-01'),
    });

    const result = await toBaseCurrency(1000, 'curr-usd', new Date('2026-08-15'));

    expect(result.amount).toBe(84500);
    expect(result.rate).toBe(84.5);
    expect(result.baseCode).toBe('INR');
  });

  // Test 2: base currency converts at parity (INR → INR = 1.0)
  it('test 2: base currency converts at parity (INR → INR = 1.0)', async () => {
    const { toBaseCurrency } = await import('../services/exchangeRateService');

    const mockPrisma = prisma as any;
    mockPrisma.currency.findFirst.mockResolvedValue({
      id: 'curr-inr',
      code: 'INR',
      symbol: '₹',
      isBaseCurrency: true,
    });

    // When currencyId matches base.id, no rate lookup needed
    const result = await toBaseCurrency(5000, 'curr-inr', new Date('2026-08-15'));

    expect(result.amount).toBe(5000);
    expect(result.rate).toBe(1);
    expect(result.baseCode).toBe('INR');
    // findFirst for exchangeRate should NOT have been called
    expect(mockPrisma.exchangeRate.findFirst).not.toHaveBeenCalled();
  });

  // Test 3: toBaseCurrency throws when no rate exists (requireRate behavior)
  it('test 3: toBaseCurrency throws when no rate exists', async () => {
    const { toBaseCurrency } = await import('../services/exchangeRateService');

    const mockPrisma = prisma as any;
    mockPrisma.currency.findFirst.mockResolvedValue({
      id: 'curr-inr',
      code: 'INR',
      symbol: '₹',
      isBaseCurrency: true,
    });
    // No rate found
    mockPrisma.exchangeRate.findFirst.mockResolvedValue(null);
    mockPrisma.currency.findUnique.mockResolvedValue({ id: 'curr-gbp', code: 'GBP' });

    await expect(
      toBaseCurrency(1000, 'curr-gbp', new Date('2026-08-15'))
    ).rejects.toThrow(/No exchange rate on record for GBP/);
  });

  // Test 4: buildRateMap: base currency is seeded at rate 1 even with no rate rows
  it('test 4: buildRateMap seeds base currency at rate 1 with no rate rows', async () => {
    const { buildRateMap } = await import('../services/exchangeRateService');

    const mockPrisma = prisma as any;
    mockPrisma.currency.findFirst.mockResolvedValue({
      id: 'curr-inr',
      code: 'INR',
      symbol: '₹',
      isBaseCurrency: true,
    });
    mockPrisma.currency.findMany.mockResolvedValue([
      { id: 'curr-inr', code: 'INR' },
    ]);
    mockPrisma.exchangeRate.findMany.mockResolvedValue([]);

    const result = await buildRateMap(new Date('2026-08-15'));

    expect(result.rates.get('curr-inr')).toBe(1);
    expect(result.base.code).toBe('INR');
    expect(result.missing).toEqual([]);
  });

  // Test 5: buildRateMap: newest rate wins when multiple rates exist for same currency
  it('test 5: buildRateMap uses newest rate when multiple exist', async () => {
    const { buildRateMap } = await import('../services/exchangeRateService');

    const mockPrisma = prisma as any;
    mockPrisma.currency.findFirst.mockResolvedValue({
      id: 'curr-inr',
      code: 'INR',
      symbol: '₹',
      isBaseCurrency: true,
    });
    mockPrisma.currency.findMany.mockResolvedValue([
      { id: 'curr-inr', code: 'INR' },
      { id: 'curr-usd', code: 'USD' },
    ]);
    // Rows are ordered newest-first (effectiveFrom desc, createdAt desc)
    // The first row for a currency wins.
    mockPrisma.exchangeRate.findMany.mockResolvedValue([
      { currencyId: 'curr-usd', exportRate: 84.5, importRate: 85.0, effectiveFrom: new Date('2026-08-15') },
      { currencyId: 'curr-usd', exportRate: 83.0, importRate: 83.5, effectiveFrom: new Date('2026-08-01') },
    ]);

    const result = await buildRateMap(new Date('2026-08-20'));

    // newest rate (84.5) should win
    expect(result.rates.get('curr-usd')).toBe(84.5);
  });

  // Test 6: buildRateMap: missing currencies appear in missing[] array
  it('test 6: buildRateMap reports missing currencies', async () => {
    const { buildRateMap } = await import('../services/exchangeRateService');

    const mockPrisma = prisma as any;
    mockPrisma.currency.findFirst.mockResolvedValue({
      id: 'curr-inr',
      code: 'INR',
      symbol: '₹',
      isBaseCurrency: true,
    });
    mockPrisma.currency.findMany.mockResolvedValue([
      { id: 'curr-inr', code: 'INR' },
      { id: 'curr-usd', code: 'USD' },
      { id: 'curr-gbp', code: 'GBP' },
    ]);
    // Only USD has a rate; GBP does not
    mockPrisma.exchangeRate.findMany.mockResolvedValue([
      { currencyId: 'curr-usd', exportRate: 84.5, importRate: 85.0, effectiveFrom: new Date('2026-08-01') },
    ]);

    const result = await buildRateMap(new Date('2026-08-15'));

    expect(result.rates.has('curr-gbp')).toBe(false);
    expect(result.missing).toContain('GBP');
    expect(result.missing).not.toContain('INR');
    expect(result.missing).not.toContain('USD');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS 9-14: Invoice route behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('Invoice routes — creation and payment', () => {
  let app: any;
  let token: string;

  beforeAll(async () => {
    app = (await import('../app')).default;
    token = createTestJwt('user-1', 'ADMIN');
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Auth middleware needs to find the user
    const mockPrisma = prisma as any;
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@test.com',
      role: 'ADMIN',
      firstName: 'Test',
      lastName: 'Admin',
      status: 'ACTIVE',
    });
  });

  // Test 9: Invoice creation: totalAmount = subtotal + taxAmount
  it('test 9: totalAmount = subtotal + taxAmount', async () => {
    const mockPrisma = prisma as any;

    mockPrisma.exportOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      buyerId: 'buyer-1',
      currency: 'USD',
      totalValue: 15000, // subtotal
      buyer: { id: 'buyer-1', companyName: 'Test Buyer' },
    });
    mockPrisma.currency.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.isBaseCurrency) {
        return { id: 'curr-inr', code: 'INR', symbol: '₹', isBaseCurrency: true };
      }
      if (args?.where?.code === 'USD') {
        return { id: 'curr-usd', code: 'USD', symbol: '$' };
      }
      return null;
    });
    mockPrisma.exchangeRate.findFirst.mockResolvedValue({
      currency: { code: 'USD' },
      exportRate: 84.5,
      importRate: 85.0,
      source: 'CBIC',
      notificationRef: 'N-01/2026',
      effectiveFrom: new Date('2026-08-01'),
    });
    mockPrisma.numberSequence.upsert.mockResolvedValue({
      entityType: 'INVOICE',
      prefix: 'INV',
      currentNo: 1,
      padLength: 5,
    });

    // Capture what gets passed to prisma.invoice.create
    let capturedData: any = null;
    mockPrisma.invoice.create.mockImplementation(async (args: any) => {
      capturedData = args.data;
      return { id: 'inv-1', ...args.data };
    });

    await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderId: 'order-1',
        dueDate: '2026-09-15',
        taxAmount: 500,
      });

    // subtotal (15000) + taxAmount (500) = totalAmount (15500)
    expect(capturedData.subtotal).toBe(15000);
    expect(capturedData.taxAmount).toBe(500);
    expect(capturedData.totalAmount).toBe(15500);
  });

  // Test 10: Invoice creation: balanceAmount equals totalAmount at creation
  it('test 10: balanceAmount equals totalAmount at creation', async () => {
    const mockPrisma = prisma as any;

    mockPrisma.exportOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      buyerId: 'buyer-1',
      currency: 'USD',
      totalValue: 10000,
      buyer: { id: 'buyer-1', companyName: 'Test Buyer' },
    });
    mockPrisma.currency.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.isBaseCurrency) {
        return { id: 'curr-inr', code: 'INR', symbol: '₹', isBaseCurrency: true };
      }
      if (args?.where?.code === 'USD') {
        return { id: 'curr-usd', code: 'USD', symbol: '$' };
      }
      return null;
    });
    mockPrisma.exchangeRate.findFirst.mockResolvedValue({
      currency: { code: 'USD' },
      exportRate: 84.5,
      importRate: 85.0,
      source: 'CBIC',
      notificationRef: null,
      effectiveFrom: new Date('2026-08-01'),
    });
    mockPrisma.numberSequence.upsert.mockResolvedValue({
      entityType: 'INVOICE',
      prefix: 'INV',
      currentNo: 2,
      padLength: 5,
    });

    let capturedData: any = null;
    mockPrisma.invoice.create.mockImplementation(async (args: any) => {
      capturedData = args.data;
      return { id: 'inv-2', ...args.data };
    });

    await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderId: 'order-1',
        dueDate: '2026-09-15',
        taxAmount: 200,
      });

    const totalAmount = 10000 + 200; // 10200
    expect(capturedData.totalAmount).toBe(totalAmount);
    expect(capturedData.balanceAmount).toBe(totalAmount);
  });

  // Test 11: Payment recording: balanceAmount decreases by payment amount
  it('test 11: balanceAmount decreases by payment amount', async () => {
    const mockPrisma = prisma as any;

    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      buyerId: 'buyer-1',
      currencyId: 'curr-usd',
      totalAmount: 10000,
      paidAmount: 0,
      balanceAmount: 10000,
      exchangeRate: 84.5,
      status: 'SENT',
    });
    mockPrisma.currency.findFirst.mockResolvedValue({
      id: 'curr-inr',
      code: 'INR',
      symbol: '₹',
      isBaseCurrency: true,
    });
    mockPrisma.exchangeRate.findFirst.mockResolvedValue({
      currency: { code: 'USD' },
      exportRate: 84.5,
      importRate: 85.0,
      source: 'CBIC',
      notificationRef: null,
      effectiveFrom: new Date('2026-08-01'),
    });
    mockPrisma.numberSequence.upsert.mockResolvedValue({
      entityType: 'PAYMENT',
      prefix: 'PAY',
      currentNo: 1,
      padLength: 5,
    });

    let invoiceUpdateData: any = null;
    mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
      const tx = {
        payment: {
          create: vi.fn().mockResolvedValue({ id: 'pay-1', amount: 3000 }),
        },
        invoice: {
          update: vi.fn().mockImplementation(async (args: any) => {
            invoiceUpdateData = args.data;
            return { id: 'inv-1', ...args.data };
          }),
        },
        buyer: {
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    await request(app)
      .post('/api/invoices/inv-1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 3000,
        paymentDate: '2026-08-20',
        paymentMode: 'BANK_TRANSFER',
      });

    // newPaidAmount = 0 + 3000 = 3000
    // newBalanceAmount = max(0, 10000 - 3000) = 7000
    expect(invoiceUpdateData.paidAmount).toBe(3000);
    expect(invoiceUpdateData.balanceAmount).toBe(7000);
  });

  // Test 12: Payment recording: status becomes PARTIALLY_PAID after partial payment
  it('test 12: status becomes PARTIALLY_PAID after partial payment', async () => {
    const mockPrisma = prisma as any;

    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      buyerId: 'buyer-1',
      currencyId: 'curr-usd',
      totalAmount: 10000,
      paidAmount: 0,
      balanceAmount: 10000,
      exchangeRate: 84.5,
      status: 'SENT',
    });
    mockPrisma.currency.findFirst.mockResolvedValue({
      id: 'curr-inr',
      code: 'INR',
      symbol: '₹',
      isBaseCurrency: true,
    });
    mockPrisma.exchangeRate.findFirst.mockResolvedValue({
      currency: { code: 'USD' },
      exportRate: 84.5,
      importRate: 85.0,
      source: 'CBIC',
      notificationRef: null,
      effectiveFrom: new Date('2026-08-01'),
    });
    mockPrisma.numberSequence.upsert.mockResolvedValue({
      entityType: 'PAYMENT',
      prefix: 'PAY',
      currentNo: 2,
      padLength: 5,
    });

    let invoiceUpdateData: any = null;
    mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
      const tx = {
        payment: { create: vi.fn().mockResolvedValue({ id: 'pay-2', amount: 5000 }) },
        invoice: {
          update: vi.fn().mockImplementation(async (args: any) => {
            invoiceUpdateData = args.data;
            return { id: 'inv-1', ...args.data };
          }),
        },
        buyer: { update: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    await request(app)
      .post('/api/invoices/inv-1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 5000,
        paymentDate: '2026-08-20',
        paymentMode: 'BANK_TRANSFER',
      });

    // balance = max(0, 10000 - 5000) = 5000 > 0.01 → PARTIALLY_PAID
    expect(invoiceUpdateData.status).toBe('PARTIALLY_PAID');
  });

  // Test 13: Payment recording: status becomes PAID when balance reaches zero
  it('test 13: status becomes PAID when balance reaches zero', async () => {
    const mockPrisma = prisma as any;

    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      buyerId: 'buyer-1',
      currencyId: 'curr-usd',
      totalAmount: 10000,
      paidAmount: 7000,
      balanceAmount: 3000,
      exchangeRate: 84.5,
      status: 'PARTIALLY_PAID',
    });
    mockPrisma.currency.findFirst.mockResolvedValue({
      id: 'curr-inr',
      code: 'INR',
      symbol: '₹',
      isBaseCurrency: true,
    });
    mockPrisma.exchangeRate.findFirst.mockResolvedValue({
      currency: { code: 'USD' },
      exportRate: 84.5,
      importRate: 85.0,
      source: 'CBIC',
      notificationRef: null,
      effectiveFrom: new Date('2026-08-01'),
    });
    mockPrisma.numberSequence.upsert.mockResolvedValue({
      entityType: 'PAYMENT',
      prefix: 'PAY',
      currentNo: 3,
      padLength: 5,
    });

    let invoiceUpdateData: any = null;
    mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
      const tx = {
        payment: { create: vi.fn().mockResolvedValue({ id: 'pay-3', amount: 3000 }) },
        invoice: {
          update: vi.fn().mockImplementation(async (args: any) => {
            invoiceUpdateData = args.data;
            return { id: 'inv-1', ...args.data };
          }),
        },
        buyer: { update: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    await request(app)
      .post('/api/invoices/inv-1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 3000,
        paymentDate: '2026-08-20',
        paymentMode: 'BANK_TRANSFER',
      });

    // newPaidAmount = 7000 + 3000 = 10000
    // newBalanceAmount = max(0, 10000 - 10000) = 0 ≤ 0.01 → PAID
    expect(invoiceUpdateData.status).toBe('PAID');
    expect(invoiceUpdateData.balanceAmount).toBe(0);
  });

  // Test 14: Payment recording: overpayment (amount > balance) returns 400
  it('test 14: overpayment returns 400', async () => {
    const mockPrisma = prisma as any;

    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      buyerId: 'buyer-1',
      currencyId: 'curr-usd',
      totalAmount: 10000,
      paidAmount: 8000,
      balanceAmount: 2000,
      exchangeRate: 84.5,
      status: 'PARTIALLY_PAID',
    });

    const res = await request(app)
      .post('/api/invoices/inv-1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 2500, // exceeds balance of 2000 (2500 > 2000 + 0.01)
        paymentDate: '2026-08-20',
        paymentMode: 'BANK_TRANSFER',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/exceeds the outstanding balance/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 15: Inclusive pricing
// ─────────────────────────────────────────────────────────────────────────────

describe('Inclusive Pricing Service', () => {
  it('test 15a: no additional costs — unit prices unchanged', () => {
    const items = [
      { quantity: 100, unitPrice: 150 },
    ];
    const result = calculateInclusiveUnitPrices(items, 0);

    expect(result.lines[0].unitPrice).toBe(150);
    expect(result.lines[0].amount).toBe(15000);
    expect(result.total).toBe(15000);
    expect(result.perUnitCost).toBe(0);
    expect(result.reconciled).toBe(true);
  });

  it('test 15b: costs spread evenly per unit', () => {
    // 100 units, goods 150/unit, freight 800 + insurance 200 = 1000 additional
    // perUnitCost = 1000 / 100 = 10
    // inclusive unit price = 150 + 10 = 160
    const items = [{ quantity: 100, unitPrice: 150 }];
    const result = calculateInclusiveUnitPrices(items, 1000);

    expect(result.perUnitCost).toBe(10);
    expect(result.lines[0].unitPrice).toBe(160);
    expect(result.lines[0].amount).toBe(16000);
    expect(result.total).toBe(16000);
    expect(result.reconciled).toBe(true);
  });

  it('test 15c: multiple lines get same per-unit cost spread', () => {
    const items = [
      { quantity: 100, unitPrice: 1440.78 },
      { quantity: 200, unitPrice: 55 },
    ];
    // total quantity = 300, perUnitCost = 12000 / 300 = 40
    const result = calculateInclusiveUnitPrices(items, 12000);

    expect(result.perUnitCost).toBe(40);
    // Line 1: 1440.78 + 40 = 1480.78, amount = 1480.78 * 100 = 148078
    expect(result.lines[0].unitPrice).toBe(1480.78);
    expect(result.lines[0].amount).toBe(148078);
    // Line 2: 55 + 40 = 95, amount = 95 * 200 = 19000
    expect(result.lines[1].unitPrice).toBe(95);
    expect(result.lines[1].amount).toBe(19000);
    expect(result.total).toBe(167078);
    expect(result.reconciled).toBe(true);
  });

  it('test 15d: indivisible costs increase precision to reconcile', () => {
    // 3 units, cost 40 → perUnitCost = 13.333...
    // At 2dp: 10 + 13.33 = 23.33, amount = 23.33 * 3 = 69.99
    // target total = 30 + 40 = 70. Gap = 0.01
    // Algorithm tries higher precision: at 3dp, 23.333 * 3 = 69.999 → round2 = 70.00
    const items = [{ quantity: 3, unitPrice: 10 }];
    const result = calculateInclusiveUnitPrices(items, 40);

    // The function increases decimals to reconcile
    const goodsTotal = 10 * 3; // 30
    const targetTotal = 30 + 40; // 70
    // Line amount should sum to something within 0.005 of target
    expect(Math.abs(result.total - targetTotal)).toBeLessThan(0.01);
    // Every line still satisfies qty * unitPrice = amount
    for (const line of result.lines) {
      const expected = Math.round((line.unitPrice * line.quantity + Number.EPSILON) * 100) / 100;
      expect(line.amount).toBe(expected);
    }
  });

  it('test 15e: remainder is reported when reconciliation is impossible', () => {
    // Large quantities with small costs that can't be expressed at 6dp
    // 25000 units, cost 137.77 → perUnitCost = 0.0055108
    const items = [{ quantity: 25000, unitPrice: 42.5 }];
    const result = calculateInclusiveUnitPrices(items, 137.77);

    // The function reports whether it reconciled or not
    if (!result.reconciled) {
      expect(result.remainder).not.toBe(0);
      // remainder = targetTotal - result.total
      const targetTotal = Math.round(((42.5 * 25000 + 137.77) + Number.EPSILON) * 100) / 100;
      expect(Math.abs(result.remainder - (targetTotal - result.total))).toBeLessThan(0.005);
    }
    // In either case, lines are internally consistent
    for (const line of result.lines) {
      const expected = Math.round((line.unitPrice * line.quantity + Number.EPSILON) * 100) / 100;
      expect(line.amount).toBe(expected);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 16: Rounding — verify round2 function
// ─────────────────────────────────────────────────────────────────────────────

describe('Rounding: round2 function', () => {
  // The round2 function is used inline in the routes: Math.round((v + Number.EPSILON) * 100) / 100
  // We test sumConverted which uses the same rounding at the end.
  const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

  it('test 16a: rounds 1.005 correctly to 1.01', () => {
    // This is the classic floating point edge case that Number.EPSILON fixes
    expect(round2(1.005)).toBe(1.01);
  });

  it('test 16b: rounds 2.344 down to 2.34', () => {
    expect(round2(2.344)).toBe(2.34);
  });

  it('test 16c: rounds 2.345 up to 2.35', () => {
    expect(round2(2.345)).toBe(2.35);
  });

  it('test 16d: leaves already-2dp numbers unchanged', () => {
    expect(round2(100.50)).toBe(100.50);
    expect(round2(0.01)).toBe(0.01);
  });

  it('test 16e: handles large values', () => {
    expect(round2(84500.126)).toBe(84500.13);
  });

  it('test 16f: sumConverted uses same round2 on the total', () => {
    const rates = new Map<string, number>();
    rates.set('c1', 84.5);
    // 1.005 * 84.5 = 84.9225 → round2 = 84.92
    // But we test the net total rounding
    const rows = [
      { amount: 0.01, currencyId: 'c1' }, // 0.01 * 84.5 = 0.845
      { amount: 0.02, currencyId: 'c1' }, // 0.02 * 84.5 = 1.69
    ];
    // total = 0.845 + 1.69 = 2.535 → round2 = 2.54
    const result = sumConverted(rows, rates);
    expect(result.total).toBe(2.54);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 17: Quotation math
// ─────────────────────────────────────────────────────────────────────────────

describe('Quotation route — creation math', () => {
  let app: any;
  let token: string;

  beforeAll(async () => {
    app = (await import('../app')).default;
    token = createTestJwt('user-1', 'ADMIN');
  });

  beforeEach(() => {
    vi.clearAllMocks();

    const mockPrisma = prisma as any;
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@test.com',
      role: 'ADMIN',
      firstName: 'Test',
      lastName: 'Admin',
      status: 'ACTIVE',
    });
  });

  it('test 17: grandTotal = subtotal + additionalCosts, margin excludes costs', async () => {
    const mockPrisma = prisma as any;

    mockPrisma.numberSequence.upsert.mockResolvedValue({
      entityType: 'QUOTATION',
      prefix: 'QT',
      currentNo: 1,
      padLength: 5,
    });

    let capturedData: any = null;
    mockPrisma.quotation.create.mockImplementation(async (args: any) => {
      capturedData = args.data;
      return {
        id: 'qt-1',
        ...args.data,
        buyer: { id: 'buyer-1', companyName: 'Test' },
        currency: { id: 'curr-usd', code: 'USD', symbol: '$' },
        incoterm: { id: 'inco-1', code: 'FOB' },
        items: [],
        costs: [],
      };
    });

    await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        buyerId: 'buyer-1',
        currencyId: 'curr-usd',
        incotermId: 'inco-1',
        validUntil: '2026-09-15',
        items: [
          { productId: 'prod-1', quantity: 100, unitCost: 120, unitPrice: 150 },
          { productId: 'prod-2', quantity: 200, unitCost: 40, unitPrice: 55 },
        ],
        costs: [
          { costType: 'FREIGHT', description: 'Sea freight', amount: 800 },
          { costType: 'INSURANCE', description: 'Marine insurance', amount: 200 },
        ],
      });

    // subtotal = (150*100) + (55*200) = 15000 + 11000 = 26000
    // additionalCosts = 800 + 200 = 1000
    // grandTotal = subtotal + additionalCosts = 26000 + 1000 = 27000
    // itemsCost = (120*100) + (40*200) = 12000 + 8000 = 20000
    // totalCost = itemsCost + additionalCosts = 20000 + 1000 = 21000
    // totalMargin = subtotal - itemsCost = 26000 - 20000 = 6000
    // marginPercent = ((26000 - 20000) / 26000) * 100 = 23.08 (from calculateMarginPercent)
    expect(capturedData.subtotal).toBe(26000);
    expect(capturedData.grandTotal).toBe(27000);
    expect(capturedData.totalCost).toBe(21000);
    expect(capturedData.totalMargin).toBe(6000);
    // marginPercent = ((price - cost) / price) * 100 = (6000/26000)*100 = 23.08 (rounded to 2dp)
    expect(capturedData.marginPercent).toBeCloseTo(23.08, 1);
  });
});
