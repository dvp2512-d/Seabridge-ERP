import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestJwt } from './setup';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock @seabridge/database
const mockPrisma = {
  user: { findUnique: vi.fn() },
  invoice: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), update: vi.fn(), create: vi.fn() },
  payment: { create: vi.fn() },
  buyer: { update: vi.fn() },
  exportOrder: { findUnique: vi.fn() },
  currency: { findFirst: vi.fn() },
  numberSequence: { upsert: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  $transaction: vi.fn(),
};

vi.mock('@seabridge/database', () => ({
  prisma: mockPrisma,
  default: mockPrisma,
  UserRole: {
    FOUNDER: 'FOUNDER',
    ADMIN: 'ADMIN',
    SALES: 'SALES',
    OPERATIONS: 'OPERATIONS',
    FINANCE: 'FINANCE',
  },
}));

vi.mock('../utils/helpers', () => ({
  generateCode: vi.fn().mockResolvedValue('PAY-00001'),
}));

vi.mock('../services/exchangeRateService', () => ({
  buildRateMap: vi.fn().mockResolvedValue({ base: 'INR', rates: new Map() }),
  findRate: vi.fn().mockResolvedValue({ rate: 83.5, notificationRef: 'TEST', effectiveFrom: new Date() }),
  toBaseCurrency: vi.fn().mockResolvedValue({ amount: 8350, currency: 'INR' }),
  getBaseCurrency: vi.fn().mockResolvedValue({ id: 'cur1', code: 'INR' }),
  buildRateMapByCode: vi.fn().mockResolvedValue({ base: 'INR', rates: new Map() }),
}));

vi.mock('../services/eventService', () => ({
  emitEvent: vi.fn(),
}));

vi.mock('../services/exportDocuments', () => ({
  buildCommercialInvoiceDocument: vi.fn(),
  buildProformaInvoiceDocument: vi.fn(),
  buildSampleInvoiceDocument: vi.fn(),
}));

vi.mock('../services/orderService', () => ({
  createOrderFromQuotation: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const FINANCE_USER = {
  id: 'user-finance-1',
  email: 'finance@test.com',
  role: 'FINANCE',
  firstName: 'Finance',
  lastName: 'User',
  status: 'ACTIVE',
};

const SALES_USER = {
  id: 'user-sales-1',
  email: 'sales@test.com',
  role: 'SALES',
  firstName: 'Sales',
  lastName: 'User',
  status: 'ACTIVE',
};

const MOCK_INVOICE = {
  id: 'inv-1',
  invoiceNumber: 'INV-00001',
  orderId: 'order-1',
  buyerId: 'buyer-1',
  currencyId: 'cur-usd',
  type: 'EXPORT',
  status: 'SENT',
  totalAmount: 10000,
  paidAmount: 0,
  balanceAmount: 10000,
  exchangeRate: 83.5,
  invoiceDate: new Date('2025-01-01'),
  dueDate: new Date('2025-02-01'),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const VALID_PAYMENT_BODY = {
  amount: 3000,
  paymentDate: '2025-01-15',
  paymentMode: 'WIRE_TRANSFER',
  reference: 'TXN-12345',
  notes: 'Partial payment',
};

let app: Express;

beforeAll(async () => {
  const mod = await import('../app');
  app = mod.default;
});

beforeEach(() => {
  vi.clearAllMocks();

  // Default: authenticate as finance user
  mockPrisma.user.findUnique.mockResolvedValue(FINANCE_USER);
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/invoices/:id/payments', () => {
  it('valid partial payment reduces balanceAmount', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ ...MOCK_INVOICE });
    mockPrisma.currency.findFirst.mockResolvedValue({ id: 'cur-inr', code: 'INR', isBaseCurrency: true });

    const createdPayment = {
      id: 'pay-1',
      paymentNumber: 'PAY-00001',
      invoiceId: 'inv-1',
      amount: 3000,
      paymentDate: new Date('2025-01-15'),
      paymentMode: 'WIRE_TRANSFER',
      reference: 'TXN-12345',
      exchangeRate: 83.5,
    };

    // Mock the transaction: capture the callback and execute it with a mock tx
    mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
      const tx = {
        payment: { create: vi.fn().mockResolvedValue(createdPayment) },
        invoice: { update: vi.fn().mockResolvedValue({}) },
        buyer: { update: vi.fn().mockResolvedValue({}) },
      };
      const result = await cb(tx);
      // Verify all three side effects were attempted
      expect(tx.payment.create).toHaveBeenCalledTimes(1);
      expect(tx.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
          data: expect.objectContaining({
            paidAmount: 3000,
            balanceAmount: 7000,
          }),
        })
      );
      expect(tx.buyer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'buyer-1' },
          data: { totalRevenue: { increment: expect.any(Number) } },
        })
      );
      return result;
    });

    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');
    const res = await request(app)
      .post('/api/invoices/inv-1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_PAYMENT_BODY);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ id: 'pay-1', paymentNumber: 'PAY-00001' });
  });

  it('payment exceeding balance returns 400', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ ...MOCK_INVOICE, balanceAmount: 1000 });

    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');
    const res = await request(app)
      .post('/api/invoices/inv-1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_PAYMENT_BODY, amount: 5000 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/exceeds/i);
  });

  it('payment equal to balance sets status to PAID', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ ...MOCK_INVOICE, balanceAmount: 5000, paidAmount: 5000, totalAmount: 10000 });
    mockPrisma.currency.findFirst.mockResolvedValue({ id: 'cur-inr', code: 'INR', isBaseCurrency: true });

    mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
      const tx = {
        payment: { create: vi.fn().mockResolvedValue({ id: 'pay-2', paymentNumber: 'PAY-00001' }) },
        invoice: { update: vi.fn().mockResolvedValue({}) },
        buyer: { update: vi.fn().mockResolvedValue({}) },
      };
      const result = await cb(tx);
      // Verify status set to PAID
      expect(tx.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PAID',
            balanceAmount: expect.any(Number),
          }),
        })
      );
      // balanceAmount should be 0 (or near zero)
      const callData = tx.invoice.update.mock.calls[0][0].data;
      expect(callData.balanceAmount).toBeLessThanOrEqual(0.01);
      return result;
    });

    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');
    const res = await request(app)
      .post('/api/invoices/inv-1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_PAYMENT_BODY, amount: 5000 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('payment less than balance sets status to PARTIALLY_PAID', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ ...MOCK_INVOICE });
    mockPrisma.currency.findFirst.mockResolvedValue({ id: 'cur-inr', code: 'INR', isBaseCurrency: true });

    mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
      const tx = {
        payment: { create: vi.fn().mockResolvedValue({ id: 'pay-3', paymentNumber: 'PAY-00001' }) },
        invoice: { update: vi.fn().mockResolvedValue({}) },
        buyer: { update: vi.fn().mockResolvedValue({}) },
      };
      const result = await cb(tx);
      // Verify status set to PARTIALLY_PAID
      expect(tx.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PARTIALLY_PAID',
          }),
        })
      );
      return result;
    });

    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');
    const res = await request(app)
      .post('/api/invoices/inv-1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_PAYMENT_BODY, amount: 2000 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('payment against CANCELLED invoice returns 400', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ ...MOCK_INVOICE, status: 'CANCELLED' });

    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');
    const res = await request(app)
      .post('/api/invoices/inv-1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_PAYMENT_BODY);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/cancelled/i);
  });

  it('requires FINANCE_MANAGE role — 401 without token', async () => {
    const res = await request(app)
      .post('/api/invoices/inv-1/payments')
      .send(VALID_PAYMENT_BODY);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('requires FINANCE_MANAGE role — 403 with SALES token', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(SALES_USER);

    const token = createTestJwt(SALES_USER.id, 'SALES');
    const res = await request(app)
      .post('/api/invoices/inv-1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_PAYMENT_BODY);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('payment on nonexistent invoice returns 404', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null);

    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');
    const res = await request(app)
      .post('/api/invoices/nonexistent-id/payments')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_PAYMENT_BODY);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('payment amount must be positive (validation)', async () => {
    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');

    const res = await request(app)
      .post('/api/invoices/inv-1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_PAYMENT_BODY, amount: -100 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);

    const resZero = await request(app)
      .post('/api/invoices/inv-1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_PAYMENT_BODY, amount: 0 });

    expect(resZero.status).toBe(400);
    expect(resZero.body.success).toBe(false);
  });
});

describe('GET /api/invoices/:id', () => {
  it('returns payments array on invoice detail', async () => {
    const invoiceWithPayments = {
      ...MOCK_INVOICE,
      buyer: { id: 'buyer-1', companyName: 'Test Corp', country: null },
      order: { id: 'order-1', items: [] },
      currency: { id: 'cur-usd', code: 'USD', symbol: '$' },
      payments: [
        { id: 'pay-1', paymentNumber: 'PAY-00001', amount: 3000, paymentDate: new Date() },
        { id: 'pay-2', paymentNumber: 'PAY-00002', amount: 2000, paymentDate: new Date() },
      ],
    };

    mockPrisma.invoice.findUnique.mockResolvedValue(invoiceWithPayments);

    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');
    const res = await request(app)
      .get('/api/invoices/inv-1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payments).toBeDefined();
    expect(Array.isArray(res.body.data.payments)).toBe(true);
    expect(res.body.data.payments).toHaveLength(2);
    expect(res.body.data.payments[0]).toMatchObject({ id: 'pay-1', paymentNumber: 'PAY-00001' });
  });
});
