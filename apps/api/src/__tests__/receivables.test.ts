/**
 * Receivables endpoint tests — DATA-001 fix verification.
 *
 * Verifies that GET /api/invoices/reports/receivables correctly converts
 * multi-currency invoice balances into the base currency (INR) using the
 * exchange rate service, and that the response shape matches the UI contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestJwt } from './setup';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock @seabridge/database — prisma client and UserRole enum
const mockPrisma = {
  user: { findUnique: vi.fn() },
  invoice: { findMany: vi.fn() },
  auditLog: { create: vi.fn() },
};

vi.mock('@seabridge/database', () => ({
  prisma: mockPrisma,
  UserRole: {
    FOUNDER: 'FOUNDER',
    ADMIN: 'ADMIN',
    SALES: 'SALES',
    OPERATIONS: 'OPERATIONS',
    FINANCE: 'FINANCE',
  },
}));

// Mock the exchange rate service at the module level
const mockBuildRateMap = vi.fn();

vi.mock('../services/exchangeRateService', () => ({
  buildRateMap: mockBuildRateMap,
  findRate: vi.fn(),
  getBaseCurrency: vi.fn(),
  requireRate: vi.fn(),
  toBaseCurrency: vi.fn(),
  buildRateMapByCode: vi.fn(),
  sumConverted: vi.fn(),
}));

// Mock event service (fire-and-forget, should not interfere)
vi.mock('../services/eventService', () => ({
  emitEvent: vi.fn(),
}));

// Mock export documents service
vi.mock('../services/exportDocuments', () => ({
  buildCommercialInvoiceDocument: vi.fn(),
  buildProformaInvoiceDocument: vi.fn(),
  buildSampleInvoiceDocument: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const FOUNDER_USER_ID = 'user-founder-001';
const FOUNDER_JWT = createTestJwt(FOUNDER_USER_ID, 'FOUNDER');

/** Simulated user record returned by prisma.user.findUnique */
const FOUNDER_USER = {
  id: FOUNDER_USER_ID,
  email: 'founder@seabridge.in',
  role: 'FOUNDER',
  firstName: 'Test',
  lastName: 'Founder',
  status: 'ACTIVE',
};

/** Currency fixtures */
const CUR_INR = { id: 'cur-inr', code: 'INR', symbol: '₹' };
const CUR_USD = { id: 'cur-usd', code: 'USD', symbol: '$' };
const CUR_EUR = { id: 'cur-eur', code: 'EUR', symbol: '€' };
const CUR_GBP = { id: 'cur-gbp', code: 'GBP', symbol: '£' };

/** Factory for realistic invoice shapes */
function makeInvoice(overrides: Partial<{
  id: string;
  invoiceNumber: string;
  status: string;
  currencyId: string;
  currency: typeof CUR_INR;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  dueDate: Date;
  buyerId: string;
  buyer: { id: string; companyName: string };
}>) {
  const id = overrides.id ?? `inv-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    invoiceNumber: overrides.invoiceNumber ?? `INV-${id.slice(4)}`,
    type: 'EXPORT',
    status: overrides.status ?? 'SENT',
    currencyId: overrides.currencyId ?? CUR_INR.id,
    currency: overrides.currency ?? CUR_INR,
    totalAmount: overrides.totalAmount ?? 10000,
    paidAmount: overrides.paidAmount ?? 0,
    balanceAmount: overrides.balanceAmount ?? overrides.totalAmount ?? 10000,
    subtotal: overrides.totalAmount ?? 10000,
    taxAmount: 0,
    invoiceDate: new Date('2026-06-01'),
    dueDate: overrides.dueDate ?? new Date('2026-09-01'),
    buyerId: overrides.buyerId ?? 'buyer-001',
    buyer: overrides.buyer ?? { id: 'buyer-001', companyName: 'Acme Corp' },
    orderId: 'order-001',
    exchangeRate: 1,
    exchangeRateRef: null,
    exchangeRateDate: null,
    createdAt: new Date('2026-06-01'),
    updatedAt: new Date('2026-06-01'),
  };
}

/** Default rate map: INR at parity, USD at 84.5, EUR at 92.0 */
function defaultRateMap(extras?: Map<string, number>) {
  const rates = new Map<string, number>([
    [CUR_INR.id, 1],
    [CUR_USD.id, 84.5],
    [CUR_EUR.id, 92.0],
  ]);
  if (extras) {
    for (const [k, v] of extras) rates.set(k, v);
  }
  return {
    base: { id: CUR_INR.id, code: 'INR', symbol: '₹' },
    rates,
    missing: [],
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  // Auth middleware: resolve the founder user
  mockPrisma.user.findUnique.mockResolvedValue(FOUNDER_USER);
  // Default: no invoices
  mockPrisma.invoice.findMany.mockResolvedValue([]);
  // Default rate map
  mockBuildRateMap.mockResolvedValue(defaultRateMap());
  // Lazy-import the app after mocks are in place
  const mod = await import('../app');
  app = mod.default;
});

describe('GET /api/invoices/reports/receivables', () => {
  // ─── 1. Single INR invoice ─────────────────────────────────────────────────
  it('1. single INR invoice: totalOutstanding = balanceAmount (rate=1), baseCurrency.code = INR', async () => {
    const inv = makeInvoice({ currencyId: CUR_INR.id, currency: CUR_INR, balanceAmount: 5000, totalAmount: 5000 });
    mockPrisma.invoice.findMany.mockResolvedValue([inv]);

    const res = await request(app)
      .get('/api/invoices/reports/receivables')
      .set('Authorization', `Bearer ${FOUNDER_JWT}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalOutstanding).toBe(5000);
    expect(res.body.data.baseCurrency.code).toBe('INR');
  });

  // ─── 2. Single USD invoice at rate 84.5 ───────────────────────────────────
  it('2. single USD invoice at rate 84.5: totalOutstanding = balance * 84.5, in INR', async () => {
    const inv = makeInvoice({ currencyId: CUR_USD.id, currency: CUR_USD, balanceAmount: 1000, totalAmount: 1000 });
    mockPrisma.invoice.findMany.mockResolvedValue([inv]);

    const res = await request(app)
      .get('/api/invoices/reports/receivables')
      .set('Authorization', `Bearer ${FOUNDER_JWT}`);

    expect(res.status).toBe(200);
    // 1000 * 84.5 = 84500
    expect(res.body.data.totalOutstanding).toBe(84500);
  });

  // ─── 3. Single EUR invoice at rate 92.0 ───────────────────────────────────
  it('3. single EUR invoice at rate 92.0: totalOutstanding = balance * 92.0, in INR', async () => {
    const inv = makeInvoice({ currencyId: CUR_EUR.id, currency: CUR_EUR, balanceAmount: 2000, totalAmount: 2000 });
    mockPrisma.invoice.findMany.mockResolvedValue([inv]);

    const res = await request(app)
      .get('/api/invoices/reports/receivables')
      .set('Authorization', `Bearer ${FOUNDER_JWT}`);

    expect(res.status).toBe(200);
    // 2000 * 92 = 184000
    expect(res.body.data.totalOutstanding).toBe(184000);
  });

  // ─── 4. Multiple currencies (USD + EUR + INR) ─────────────────────────────
  it('4. multiple currencies: total is the correct INR sum of all three', async () => {
    const invINR = makeInvoice({ id: 'inv-inr', currencyId: CUR_INR.id, currency: CUR_INR, balanceAmount: 10000, totalAmount: 10000 });
    const invUSD = makeInvoice({ id: 'inv-usd', currencyId: CUR_USD.id, currency: CUR_USD, balanceAmount: 500, totalAmount: 500 });
    const invEUR = makeInvoice({ id: 'inv-eur', currencyId: CUR_EUR.id, currency: CUR_EUR, balanceAmount: 300, totalAmount: 300 });
    mockPrisma.invoice.findMany.mockResolvedValue([invINR, invUSD, invEUR]);

    const res = await request(app)
      .get('/api/invoices/reports/receivables')
      .set('Authorization', `Bearer ${FOUNDER_JWT}`);

    expect(res.status).toBe(200);
    // INR: 10000 * 1 = 10000
    // USD: 500 * 84.5 = 42250
    // EUR: 300 * 92 = 27600
    // Total: 79850
    expect(res.body.data.totalOutstanding).toBe(79850);
  });

  // ─── 5. Partially paid invoice uses balanceAmount ─────────────────────────
  it('5. partially paid invoice: totalOutstanding uses balanceAmount (not totalAmount)', async () => {
    const inv = makeInvoice({
      currencyId: CUR_USD.id,
      currency: CUR_USD,
      totalAmount: 2000,
      paidAmount: 800,
      balanceAmount: 1200,
    });
    mockPrisma.invoice.findMany.mockResolvedValue([inv]);

    const res = await request(app)
      .get('/api/invoices/reports/receivables')
      .set('Authorization', `Bearer ${FOUNDER_JWT}`);

    expect(res.status).toBe(200);
    // 1200 * 84.5 = 101400
    expect(res.body.data.totalOutstanding).toBe(101400);
  });

  // ─── 6. Fully paid invoice (status PAID): NOT included ────────────────────
  it('6. fully paid invoice (status PAID): NOT included (endpoint filters status)', async () => {
    // The prisma findMany is mocked — we simulate the DB filter by returning nothing
    // when the only invoice is PAID (as prisma would filter it out).
    mockPrisma.invoice.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/invoices/reports/receivables')
      .set('Authorization', `Bearer ${FOUNDER_JWT}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalOutstanding).toBe(0);
    expect(res.body.data.count).toBe(0);
    expect(res.body.data.invoices).toHaveLength(0);
  });

  // ─── 7. Zero balance invoice (balanceAmount=0): NOT included ──────────────
  it('7. zero balance invoice (balanceAmount=0): NOT included (endpoint filters gt:0)', async () => {
    // Same as above - prisma's where clause { balanceAmount: { gt: 0 } } filters it
    mockPrisma.invoice.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/invoices/reports/receivables')
      .set('Authorization', `Bearer ${FOUNDER_JWT}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalOutstanding).toBe(0);
    expect(res.body.data.count).toBe(0);
  });

  // ─── 8. Missing exchange rate → unconvertedRecords ────────────────────────
  it('8. missing exchange rate: invoice counted in unconvertedRecords, not added to total', async () => {
    // GBP has no rate in our rate map
    const inv = makeInvoice({ currencyId: CUR_GBP.id, currency: CUR_GBP, balanceAmount: 5000, totalAmount: 5000 });
    mockPrisma.invoice.findMany.mockResolvedValue([inv]);

    const res = await request(app)
      .get('/api/invoices/reports/receivables')
      .set('Authorization', `Bearer ${FOUNDER_JWT}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalOutstanding).toBe(0);
    expect(res.body.data.unconvertedRecords).toBe(1);
  });

  // ─── 9. Mixed: one convertible USD + one missing-rate GBP ─────────────────
  it('9. mixed: one convertible USD invoice + one missing-rate GBP → total is USD only, unconvertedRecords=1', async () => {
    const invUSD = makeInvoice({ id: 'inv-usd', currencyId: CUR_USD.id, currency: CUR_USD, balanceAmount: 1000, totalAmount: 1000 });
    const invGBP = makeInvoice({ id: 'inv-gbp', currencyId: CUR_GBP.id, currency: CUR_GBP, balanceAmount: 2000, totalAmount: 2000 });
    mockPrisma.invoice.findMany.mockResolvedValue([invUSD, invGBP]);

    const res = await request(app)
      .get('/api/invoices/reports/receivables')
      .set('Authorization', `Bearer ${FOUNDER_JWT}`);

    expect(res.status).toBe(200);
    // Only the USD invoice contributes: 1000 * 84.5 = 84500
    expect(res.body.data.totalOutstanding).toBe(84500);
    expect(res.body.data.unconvertedRecords).toBe(1);
  });

  // ─── 10. Response includes baseCurrency object with code and symbol ───────
  it('10. response includes baseCurrency object with code and symbol', async () => {
    const res = await request(app)
      .get('/api/invoices/reports/receivables')
      .set('Authorization', `Bearer ${FOUNDER_JWT}`);

    expect(res.status).toBe(200);
    expect(res.body.data.baseCurrency).toBeDefined();
    expect(res.body.data.baseCurrency.code).toBe('INR');
    expect(res.body.data.baseCurrency.symbol).toBe('₹');
  });

  // ─── 11. Response includes unconvertedRecords field ────────────────────────
  it('11. response includes unconvertedRecords field', async () => {
    const res = await request(app)
      .get('/api/invoices/reports/receivables')
      .set('Authorization', `Bearer ${FOUNDER_JWT}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('unconvertedRecords');
    expect(typeof res.body.data.unconvertedRecords).toBe('number');
  });

  // ─── 12. Response includes count field ─────────────────────────────────────
  it('12. response includes count field', async () => {
    const inv = makeInvoice({ currencyId: CUR_INR.id, currency: CUR_INR, balanceAmount: 100, totalAmount: 100 });
    mockPrisma.invoice.findMany.mockResolvedValue([inv]);

    const res = await request(app)
      .get('/api/invoices/reports/receivables')
      .set('Authorization', `Bearer ${FOUNDER_JWT}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
  });

  // ─── 13. Response includes invoices array with original currency ──────────
  it('13. response includes invoices array with original currency (not converted)', async () => {
    const inv = makeInvoice({ currencyId: CUR_USD.id, currency: CUR_USD, balanceAmount: 500, totalAmount: 500 });
    mockPrisma.invoice.findMany.mockResolvedValue([inv]);

    const res = await request(app)
      .get('/api/invoices/reports/receivables')
      .set('Authorization', `Bearer ${FOUNDER_JWT}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices).toHaveLength(1);
    expect(res.body.data.invoices[0].currency.code).toBe('USD');
    expect(res.body.data.invoices[0].currencyId).toBe(CUR_USD.id);
  });

  // ─── 14. Individual invoice balanceAmount is NOT modified ─────────────────
  it('14. individual invoice balanceAmount is NOT modified by the conversion', async () => {
    const inv = makeInvoice({ currencyId: CUR_USD.id, currency: CUR_USD, balanceAmount: 1234.56, totalAmount: 2000 });
    mockPrisma.invoice.findMany.mockResolvedValue([inv]);

    const res = await request(app)
      .get('/api/invoices/reports/receivables')
      .set('Authorization', `Bearer ${FOUNDER_JWT}`);

    expect(res.status).toBe(200);
    // The invoice's own balanceAmount must remain 1234.56 (USD), not multiplied
    expect(res.body.data.invoices[0].balanceAmount).toBe(1234.56);
  });

  // ─── 15. Unauthenticated request returns 401 ──────────────────────────────
  it('15. unauthenticated request returns 401', async () => {
    const res = await request(app)
      .get('/api/invoices/reports/receivables');

    expect(res.status).toBe(401);
  });
});
