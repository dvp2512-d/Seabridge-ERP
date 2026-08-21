/**
 * PDF endpoint tests.
 *
 * These verify the HTTP layer around PDF generation: auth, content-type,
 * routing to the correct builder, and graceful errors. They do NOT parse PDF
 * content — the scripts/verify-export-documents.ts and
 * scripts/verify-document-content.ts handle that exhaustively.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestJwt } from './setup';

// --- Mocks ---

// Mock @seabridge/database — provides prisma and UserRole
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
    },
    companyProfile: {
      findFirst: vi.fn(),
    },
    currency: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  };

  return { prisma, UserRole, default: prisma };
});

// Mock the PDF builder functions
const mockBuildCommercialInvoice = vi.fn();
const mockBuildProformaInvoice = vi.fn();
const mockBuildSampleInvoice = vi.fn();

vi.mock('../services/exportDocuments', () => ({
  buildCommercialInvoiceDocument: (...args: any[]) => mockBuildCommercialInvoice(...args),
  buildProformaInvoiceDocument: (...args: any[]) => mockBuildProformaInvoice(...args),
  buildSampleInvoiceDocument: (...args: any[]) => mockBuildSampleInvoice(...args),
}));

// Mock exchange rate service
vi.mock('../services/exchangeRateService', () => ({
  buildRateMap: vi.fn().mockResolvedValue({ base: 'INR', rates: new Map() }),
  findRate: vi.fn().mockResolvedValue(null),
  getBaseCurrency: vi.fn().mockResolvedValue({ id: 'cur-inr', code: 'INR', symbol: '₹' }),
  toBaseCurrency: vi.fn().mockResolvedValue({ amount: 0, rate: 1 }),
}));

// Mock event service
vi.mock('../services/eventService', () => ({
  emitEvent: vi.fn(),
}));

// --- Test data ---

const TEST_USER_ID = 'user-pdf-test-001';
const INVOICE_ID = 'inv-test-001';

/** Minimal authenticated user returned by prisma.user.findUnique in the auth middleware */
function activeUser(role: string = 'FINANCE') {
  return {
    id: TEST_USER_ID,
    email: 'test@seabridge.com',
    role,
    firstName: 'Test',
    lastName: 'User',
    status: 'ACTIVE',
  };
}

/** Full invoice object including relations, as returned by findUnique with includes */
function fullInvoice(type: 'EXPORT' | 'PROFORMA' | 'SAMPLE' = 'EXPORT') {
  return {
    id: INVOICE_ID,
    invoiceNumber: 'INV-2026-0001',
    type,
    invoiceDate: new Date('2026-08-16'),
    dueDate: new Date('2026-09-16'),
    subtotal: 5900,
    taxAmount: 0,
    totalAmount: 5900,
    balanceAmount: 5900,
    paidAmount: 0,
    exchangeRate: 84.5,
    exchangeRateRef: 'N-123',
    exchangeRateDate: new Date('2026-08-15'),
    currencyId: 'cur-usd',
    buyerId: 'buyer-001',
    orderId: 'order-001',
    status: 'SENT',
    currency: { id: 'cur-usd', code: 'USD', symbol: '$' },
    buyer: {
      companyName: 'MartinoRossi SpA',
      address: 'Via Test 1',
      city: 'Milan',
      country: { name: 'Italy' },
      contacts: [{ firstName: 'Luca', isPrimary: true }],
    },
    order: {
      orderNumber: 'SO-2026-0001',
      poNumber: 'PO-8891',
      dispatchMethod: 'Sea',
      shipmentType: 'FCL',
      variationPercent: 10,
      items: [
        {
          product: { hsnCode: '12119032', code: 'PSY-99', name: 'Psyllium Husk Powder' },
          quantity: 500,
          unit: 'KG',
          unitPrice: 11.8,
          totalPrice: 5900,
        },
      ],
      shipments: [
        {
          originPort: { name: 'Ahmedabad', country: null },
          destinationPort: { name: 'Genoa', country: null },
          vesselName: 'MV SEABRIDGE',
        },
      ],
      portOfLoading: { name: 'Ahmedabad', country: { name: 'India' } },
      portOfDischarge: { name: 'Genoa', country: { name: 'Italy' } },
    },
  };
}

const FAKE_PDF_BUFFER = Buffer.from('%PDF-1.4 fake pdf content for testing purposes');

const COMPANY_PROFILE = {
  legalName: 'VISION LIMELITE',
  tradeName: 'SeaBridge Exports',
  city: 'Ahmedabad',
  state: 'Gujarat',
  country: 'INDIA',
  gstNumber: '24DUBPP8360J1ZB',
  bankName: 'Kotak Mahindra Bank',
  bankAccountNo: '8347672514',
};

// --- Tests ---

describe('GET /api/invoices/:id/pdf', () => {
  let app: any;
  let prisma: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import mocked prisma
    const db = await import('@seabridge/database');
    prisma = db.prisma;

    // Default: auth passes for FINANCE role user
    prisma.user.findUnique.mockResolvedValue(activeUser('FINANCE'));

    // Reset builders to return a valid PDF buffer
    mockBuildCommercialInvoice.mockResolvedValue(FAKE_PDF_BUFFER);
    mockBuildProformaInvoice.mockResolvedValue(FAKE_PDF_BUFFER);
    mockBuildSampleInvoice.mockResolvedValue(FAKE_PDF_BUFFER);

    // Default invoice and company
    prisma.invoice.findUnique.mockResolvedValue(fullInvoice('EXPORT'));
    prisma.companyProfile.findFirst.mockResolvedValue(COMPANY_PROFILE);

    // Import the app fresh
    const { default: appModule } = await import('../app');
    app = appModule;
  });

  it('requires authentication — rejects request without token', async () => {
    const res = await request(app).get(`/api/invoices/${INVOICE_ID}/pdf`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('requires authentication — rejects invalid token', async () => {
    const res = await request(app)
      .get(`/api/invoices/${INVOICE_ID}/pdf`)
      .set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(401);
  });

  it('FINANCE role can access the PDF endpoint', async () => {
    const token = createTestJwt(TEST_USER_ID, 'FINANCE');
    prisma.user.findUnique.mockResolvedValue(activeUser('FINANCE'));

    const res = await request(app)
      .get(`/api/invoices/${INVOICE_ID}/pdf`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  it('SALES role cannot access the PDF endpoint (FINANCE_VIEW required)', async () => {
    const token = createTestJwt(TEST_USER_ID, 'SALES');
    prisma.user.findUnique.mockResolvedValue(activeUser('SALES'));

    const res = await request(app)
      .get(`/api/invoices/${INVOICE_ID}/pdf`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('returns Content-Type: application/pdf', async () => {
    const token = createTestJwt(TEST_USER_ID, 'FINANCE');

    const res = await request(app)
      .get(`/api/invoices/${INVOICE_ID}/pdf`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  it('returns a non-empty buffer', async () => {
    const token = createTestJwt(TEST_USER_ID, 'FINANCE');

    const res = await request(app)
      .get(`/api/invoices/${INVOICE_ID}/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('returns Content-Disposition with filename', async () => {
    const token = createTestJwt(TEST_USER_ID, 'FINANCE');

    const res = await request(app)
      .get(`/api/invoices/${INVOICE_ID}/pdf`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/filename=/);
  });

  it('returns 404 for non-existent invoice', async () => {
    const token = createTestJwt(TEST_USER_ID, 'FINANCE');
    prisma.invoice.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/invoices/nonexistent-id/pdf')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  describe('routes to correct builder by invoice type', () => {
    it('EXPORT type uses buildCommercialInvoiceDocument', async () => {
      const token = createTestJwt(TEST_USER_ID, 'FINANCE');
      prisma.invoice.findUnique.mockResolvedValue(fullInvoice('EXPORT'));

      await request(app)
        .get(`/api/invoices/${INVOICE_ID}/pdf`)
        .set('Authorization', `Bearer ${token}`);

      expect(mockBuildCommercialInvoice).toHaveBeenCalledTimes(1);
      expect(mockBuildProformaInvoice).not.toHaveBeenCalled();
      expect(mockBuildSampleInvoice).not.toHaveBeenCalled();
    });

    it('PROFORMA type uses buildProformaInvoiceDocument', async () => {
      const token = createTestJwt(TEST_USER_ID, 'FINANCE');
      prisma.invoice.findUnique.mockResolvedValue(fullInvoice('PROFORMA'));

      await request(app)
        .get(`/api/invoices/${INVOICE_ID}/pdf`)
        .set('Authorization', `Bearer ${token}`);

      expect(mockBuildProformaInvoice).toHaveBeenCalledTimes(1);
      expect(mockBuildCommercialInvoice).not.toHaveBeenCalled();
      expect(mockBuildSampleInvoice).not.toHaveBeenCalled();
    });

    it('SAMPLE type uses buildSampleInvoiceDocument', async () => {
      const token = createTestJwt(TEST_USER_ID, 'FINANCE');
      prisma.invoice.findUnique.mockResolvedValue(fullInvoice('SAMPLE'));

      await request(app)
        .get(`/api/invoices/${INVOICE_ID}/pdf`)
        .set('Authorization', `Bearer ${token}`);

      expect(mockBuildSampleInvoice).toHaveBeenCalledTimes(1);
      expect(mockBuildCommercialInvoice).not.toHaveBeenCalled();
      expect(mockBuildProformaInvoice).not.toHaveBeenCalled();
    });
  });

  describe('missing company profile', () => {
    it('returns 400 (not 500) when company profile is missing', async () => {
      const token = createTestJwt(TEST_USER_ID, 'FINANCE');
      prisma.companyProfile.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/invoices/${INVOICE_ID}/pdf`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/[Cc]ompany [Pp]rofile/);
    });

    it('returns a helpful error message mentioning Settings', async () => {
      const token = createTestJwt(TEST_USER_ID, 'FINANCE');
      prisma.companyProfile.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/invoices/${INVOICE_ID}/pdf`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.body.message).toMatch(/[Ss]ettings/);
    });
  });

  it('builder receives the invoice object and company profile', async () => {
    const token = createTestJwt(TEST_USER_ID, 'FINANCE');
    const invoice = fullInvoice('EXPORT');
    prisma.invoice.findUnique.mockResolvedValue(invoice);
    prisma.companyProfile.findFirst.mockResolvedValue(COMPANY_PROFILE);

    await request(app)
      .get(`/api/invoices/${INVOICE_ID}/pdf`)
      .set('Authorization', `Bearer ${token}`);

    expect(mockBuildCommercialInvoice).toHaveBeenCalledWith(
      invoice,
      expect.objectContaining({ legalName: 'VISION LIMELITE', baseCurrencyCode: 'INR' })
    );
  });
});
