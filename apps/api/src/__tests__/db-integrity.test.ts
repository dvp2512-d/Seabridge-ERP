/**
 * Database integrity and operation pattern tests.
 *
 * Verifies that routes use transactions, guard against data corruption, and
 * return helpful errors rather than raw database exceptions. No real database
 * is needed — prisma is fully mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestJwt } from './setup';

// --- Mocks ---

vi.mock('@seabridge/database', () => {
  const UserRole = {
    FOUNDER: 'FOUNDER',
    ADMIN: 'ADMIN',
    SALES: 'SALES',
    OPERATIONS: 'OPERATIONS',
    FINANCE: 'FINANCE',
  };

  const prisma = {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      update: vi.fn(),
    },
    invoice: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    exportOrder: {
      findUnique: vi.fn(),
    },
    currency: {
      findFirst: vi.fn(),
    },
    payment: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    buyer: {
      update: vi.fn(),
    },
    companyProfile: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  };

  return { prisma, UserRole, default: prisma };
});

// Mock exchange rate service
vi.mock('../services/exchangeRateService', () => ({
  buildRateMap: vi.fn().mockResolvedValue({ base: 'INR', rates: new Map() }),
  findRate: vi.fn().mockResolvedValue(null),
  getBaseCurrency: vi.fn().mockResolvedValue({ id: 'cur-inr', code: 'INR', symbol: '₹' }),
  // Return non-zero amount so buyer revenue update is triggered
  toBaseCurrency: vi.fn().mockResolvedValue({ amount: 16900, rate: 84.5, baseCode: 'INR' }),
}));

// Mock event service
vi.mock('../services/eventService', () => ({
  emitEvent: vi.fn(),
}));

// Mock export documents
vi.mock('../services/exportDocuments', () => ({
  buildCommercialInvoiceDocument: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
  buildProformaInvoiceDocument: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
  buildSampleInvoiceDocument: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
}));

// Mock helpers — generateCode
vi.mock('../utils/helpers', () => ({
  generateCode: vi.fn().mockResolvedValue('INV-2026-TEST'),
}));

// --- Constants ---

const ADMIN_USER_ID = 'user-admin-001';
const FOUNDER_USER_ID = 'user-founder-001';
const TARGET_USER_ID = 'user-target-001';
const INVOICE_ID = 'inv-db-test-001';

function activeUser(id: string, role: string = 'ADMIN') {
  return {
    id,
    email: `${id}@seabridge.com`,
    role,
    firstName: 'Test',
    lastName: 'Admin',
    status: 'ACTIVE',
  };
}

// --- Tests ---

describe('DB Integrity: Payment Recording Transaction', () => {
  let app: any;
  let prisma: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('@seabridge/database');
    prisma = db.prisma;

    // Default user auth (FINANCE role for payment operations)
    prisma.user.findUnique.mockResolvedValue(activeUser(ADMIN_USER_ID, 'FOUNDER'));

    const { default: appModule } = await import('../app');
    app = appModule;
  });

  it('payment recording uses prisma.$transaction', async () => {
    const token = createTestJwt(ADMIN_USER_ID, 'FOUNDER');

    // Invoice that can receive a payment
    prisma.invoice.findUnique.mockResolvedValue({
      id: INVOICE_ID,
      invoiceNumber: 'INV-2026-0001',
      totalAmount: 5900,
      paidAmount: 0,
      balanceAmount: 5900,
      currencyId: 'cur-usd',
      buyerId: 'buyer-001',
      exchangeRate: 84.5,
      status: 'SENT',
    });

    // No existing idempotent payment
    prisma.payment.findUnique.mockResolvedValue(null);

    // The $transaction callback now uses $queryRaw for SELECT FOR UPDATE
    prisma.$transaction.mockImplementation(async (cb: Function) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{
          id: INVOICE_ID,
          balance_amount: '5900',
          paid_amount: '0',
          total_amount: '5900',
          buyer_id: 'buyer-001',
        }]),
        payment: { create: vi.fn().mockResolvedValue({ id: 'pay-001', paymentNumber: 'PAY-001' }) },
        invoice: { update: vi.fn().mockResolvedValue({}) },
        buyer: { update: vi.fn().mockResolvedValue({}) },
      };
      return cb(tx);
    });

    // Also mock currency lookup for rate resolution
    prisma.currency.findFirst.mockResolvedValue({ id: 'cur-inr', code: 'INR', isBaseCurrency: true });

    const res = await request(app)
      .post(`/api/invoices/${INVOICE_ID}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 2000,
        paymentDate: '2026-08-20',
        paymentMode: 'Wire Transfer',
        reference: 'TXN-001',
      });

    expect(res.status).toBe(201);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('$transaction callback creates payment, updates invoice, and updates buyer revenue', async () => {
    const token = createTestJwt(ADMIN_USER_ID, 'FOUNDER');

    prisma.invoice.findUnique.mockResolvedValue({
      id: INVOICE_ID,
      invoiceNumber: 'INV-2026-0001',
      totalAmount: 5900,
      paidAmount: 0,
      balanceAmount: 5900,
      currencyId: 'cur-usd',
      buyerId: 'buyer-001',
      exchangeRate: 84.5,
      status: 'SENT',
    });

    prisma.payment.findUnique.mockResolvedValue(null);

    const txQueryRaw = vi.fn().mockResolvedValue([{
      id: INVOICE_ID,
      balance_amount: '5900',
      paid_amount: '0',
      total_amount: '5900',
      buyer_id: 'buyer-001',
    }]);
    const txPaymentCreate = vi.fn().mockResolvedValue({ id: 'pay-001', paymentNumber: 'PAY-001' });
    const txInvoiceUpdate = vi.fn().mockResolvedValue({});
    const txBuyerUpdate = vi.fn().mockResolvedValue({});

    prisma.$transaction.mockImplementation(async (cb: Function) => {
      const tx = {
        $queryRaw: txQueryRaw,
        payment: { create: txPaymentCreate },
        invoice: { update: txInvoiceUpdate },
        buyer: { update: txBuyerUpdate },
      };
      return cb(tx);
    });

    prisma.currency.findFirst.mockResolvedValue({ id: 'cur-inr', code: 'INR', isBaseCurrency: true });

    const res = await request(app)
      .post(`/api/invoices/${INVOICE_ID}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 2000,
        paymentDate: '2026-08-20',
        paymentMode: 'Wire Transfer',
      });

    expect(res.status).toBe(201);

    // SELECT FOR UPDATE was called
    expect(txQueryRaw).toHaveBeenCalledTimes(1);
    // All three operations were called inside the transaction
    expect(txPaymentCreate).toHaveBeenCalledTimes(1);
    expect(txInvoiceUpdate).toHaveBeenCalledTimes(1);
    expect(txBuyerUpdate).toHaveBeenCalledTimes(1);

    // Invoice update sets correct paid/balance amounts
    expect(txInvoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INVOICE_ID },
        data: expect.objectContaining({
          paidAmount: 2000,
          balanceAmount: 3900,
          status: 'PARTIALLY_PAID',
        }),
      })
    );
  });

  it('payment that fully pays invoice sets status to PAID', async () => {
    const token = createTestJwt(ADMIN_USER_ID, 'FOUNDER');

    prisma.invoice.findUnique.mockResolvedValue({
      id: INVOICE_ID,
      invoiceNumber: 'INV-2026-0001',
      totalAmount: 5900,
      paidAmount: 0,
      balanceAmount: 5900,
      currencyId: 'cur-usd',
      buyerId: 'buyer-001',
      exchangeRate: 84.5,
      status: 'SENT',
    });

    prisma.payment.findUnique.mockResolvedValue(null);

    const txInvoiceUpdate = vi.fn().mockResolvedValue({});

    prisma.$transaction.mockImplementation(async (cb: Function) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{
          id: INVOICE_ID,
          balance_amount: '5900',
          paid_amount: '0',
          total_amount: '5900',
          buyer_id: 'buyer-001',
        }]),
        payment: { create: vi.fn().mockResolvedValue({ id: 'pay-001', paymentNumber: 'PAY-001' }) },
        invoice: { update: txInvoiceUpdate },
        buyer: { update: vi.fn().mockResolvedValue({}) },
      };
      return cb(tx);
    });

    prisma.currency.findFirst.mockResolvedValue({ id: 'cur-inr', code: 'INR', isBaseCurrency: true });

    const res = await request(app)
      .post(`/api/invoices/${INVOICE_ID}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 5900,
        paymentDate: '2026-08-20',
        paymentMode: 'Wire Transfer',
      });

    expect(res.status).toBe(201);
    expect(txInvoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PAID' }),
      })
    );
  });
});

describe('DB Integrity: User Deactivation', () => {
  let app: any;
  let prisma: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('@seabridge/database');
    prisma = db.prisma;

    prisma.user.findUnique.mockResolvedValue(activeUser(ADMIN_USER_ID, 'FOUNDER'));

    const { default: appModule } = await import('../app');
    app = appModule;
  });

  it('does not hard-delete the user record — uses update to set INACTIVE', async () => {
    const token = createTestJwt(ADMIN_USER_ID, 'FOUNDER');

    // Auth middleware returns the requesting user
    prisma.user.findUnique
      .mockResolvedValueOnce(activeUser(ADMIN_USER_ID, 'FOUNDER')) // auth
      .mockResolvedValueOnce({ // target user
        id: TARGET_USER_ID,
        firstName: 'Target',
        lastName: 'User',
        role: 'SALES',
        status: 'ACTIVE',
      });

    prisma.user.update.mockResolvedValue({ id: TARGET_USER_ID, status: 'INACTIVE' });

    const res = await request(app)
      .delete(`/api/users/${TARGET_USER_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Verify it called update (soft-deactivate), NOT delete
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TARGET_USER_ID },
        data: { status: 'INACTIVE' },
      })
    );
  });

  it('prevents self-deactivation', async () => {
    const token = createTestJwt(FOUNDER_USER_ID, 'FOUNDER');

    // Auth returns the founder
    prisma.user.findUnique
      .mockResolvedValueOnce(activeUser(FOUNDER_USER_ID, 'FOUNDER')) // auth middleware
      .mockResolvedValueOnce({ // target = same user
        id: FOUNDER_USER_ID,
        firstName: 'Test',
        lastName: 'Founder',
        role: 'FOUNDER',
        status: 'ACTIVE',
      });

    const res = await request(app)
      .delete(`/api/users/${FOUNDER_USER_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot deactivate your own/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('only-last-founder protection: rejects deactivating the sole active founder', async () => {
    const token = createTestJwt(ADMIN_USER_ID, 'FOUNDER');

    // Auth middleware passes
    prisma.user.findUnique
      .mockResolvedValueOnce(activeUser(ADMIN_USER_ID, 'FOUNDER')) // auth
      .mockResolvedValueOnce({ // target founder
        id: TARGET_USER_ID,
        firstName: 'Solo',
        lastName: 'Founder',
        role: 'FOUNDER',
        status: 'ACTIVE',
      });

    // Only 1 active founder exists
    prisma.user.count.mockResolvedValue(1);

    const res = await request(app)
      .delete(`/api/users/${TARGET_USER_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/only active founder/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows deactivating a founder when there are multiple active founders', async () => {
    const token = createTestJwt(ADMIN_USER_ID, 'FOUNDER');

    prisma.user.findUnique
      .mockResolvedValueOnce(activeUser(ADMIN_USER_ID, 'FOUNDER')) // auth
      .mockResolvedValueOnce({ // target
        id: TARGET_USER_ID,
        firstName: 'Other',
        lastName: 'Founder',
        role: 'FOUNDER',
        status: 'ACTIVE',
      });

    // 2 active founders exist
    prisma.user.count.mockResolvedValue(2);
    prisma.user.update.mockResolvedValue({ id: TARGET_USER_ID, status: 'INACTIVE' });

    const res = await request(app)
      .delete(`/api/users/${TARGET_USER_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalled();
  });
});

describe('DB Integrity: Duplicate Email Prevention', () => {
  let app: any;
  let prisma: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('@seabridge/database');
    prisma = db.prisma;

    prisma.user.findUnique.mockResolvedValue(activeUser(ADMIN_USER_ID, 'FOUNDER'));

    const { default: appModule } = await import('../app');
    app = appModule;
  });

  it('returns 409 with helpful message when Prisma throws unique constraint (P2002)', async () => {
    const token = createTestJwt(ADMIN_USER_ID, 'FOUNDER');

    // Simulate P2002 unique constraint violation
    const prismaError = new Error('Unique constraint failed on the fields: (`email`)');
    (prismaError as any).name = 'PrismaClientKnownRequestError';
    (prismaError as any).code = 'P2002';
    (prismaError as any).meta = { target: ['email'] };

    prisma.user.create.mockRejectedValue(prismaError);

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'duplicate@seabridge.com',
        password: 'SecurePass123!',
        firstName: 'Dup',
        lastName: 'User',
        role: 'SALES',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/email/i);
    // Should NOT be a raw error or 500
    expect(res.body.message).not.toMatch(/prisma/i);
  });
});

describe('DB Integrity: Invoice Creation — Unknown Currency', () => {
  let app: any;
  let prisma: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('@seabridge/database');
    prisma = db.prisma;

    prisma.user.findUnique.mockResolvedValue(activeUser(ADMIN_USER_ID, 'FOUNDER'));

    const { default: appModule } = await import('../app');
    app = appModule;
  });

  it('returns 400 when order currency is not configured in master data', async () => {
    const token = createTestJwt(ADMIN_USER_ID, 'FOUNDER');

    // Order exists but has an unconfigured currency
    prisma.exportOrder.findUnique.mockResolvedValue({
      id: 'order-001',
      orderNumber: 'SO-2026-0001',
      currency: 'XYZ', // Not in the currency table
      totalValue: 5000,
      buyerId: 'buyer-001',
      buyer: { companyName: 'Test Buyer' },
    });

    // Currency lookup returns null
    prisma.currency.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderId: 'order-001',
        dueDate: '2026-09-20',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/[Cc]urrency.*XYZ/);
    // Must not be a 500 or raw DB error
    expect(res.status).not.toBe(500);
  });

  it('error message suggests adding the currency in Master Data', async () => {
    const token = createTestJwt(ADMIN_USER_ID, 'FOUNDER');

    prisma.exportOrder.findUnique.mockResolvedValue({
      id: 'order-001',
      orderNumber: 'SO-2026-0001',
      currency: 'BTC',
      totalValue: 1,
      buyerId: 'buyer-001',
      buyer: { companyName: 'Test Buyer' },
    });

    prisma.currency.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderId: 'order-001',
        dueDate: '2026-09-20',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/[Mm]aster [Dd]ata/);
  });
});
