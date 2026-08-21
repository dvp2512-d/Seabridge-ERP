import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestJwt } from './setup';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockPrisma = {
  user: { findUnique: vi.fn() },
  inquiry: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
  inquiryItem: { create: vi.fn() },
  followUp: { create: vi.fn() },
  quotation: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
  exportOrder: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
  invoice: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
  payment: { create: vi.fn() },
  buyer: { update: vi.fn() },
  currency: { findFirst: vi.fn() },
  companyProfile: { findFirst: vi.fn() },
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
  InquiryStage: {
    NEW: 'NEW',
    REQUIREMENT_GATHERED: 'REQUIREMENT_GATHERED',
    PRICING_IN_PROGRESS: 'PRICING_IN_PROGRESS',
    QUOTATION_SENT: 'QUOTATION_SENT',
    NEGOTIATION: 'NEGOTIATION',
    WON: 'WON',
    LOST: 'LOST',
    ON_HOLD: 'ON_HOLD',
  },
  Prisma: {
    QuotationUpdateInput: {},
  },
}));

vi.mock('../utils/helpers', () => ({
  generateCode: vi.fn().mockResolvedValue('CODE-00001'),
  calculateMarginPercent: vi.fn().mockReturnValue(25),
}));

vi.mock('../services/exchangeRateService', () => ({
  buildRateMap: vi.fn().mockResolvedValue({ base: 'INR', rates: new Map() }),
  buildRateMapByCode: vi.fn().mockResolvedValue({ base: 'INR', rates: new Map() }),
  findRate: vi.fn().mockResolvedValue({ rate: 83.5, notificationRef: 'TEST', effectiveFrom: new Date() }),
  toBaseCurrency: vi.fn().mockResolvedValue({ amount: 8350, currency: 'INR' }),
  getBaseCurrency: vi.fn().mockResolvedValue({ id: 'cur1', code: 'INR' }),
}));

vi.mock('../services/eventService', () => ({
  emitEvent: vi.fn(),
}));

vi.mock('../services/exportDocuments', () => ({
  buildCommercialInvoiceDocument: vi.fn(),
  buildProformaInvoiceDocument: vi.fn(),
  buildSampleInvoiceDocument: vi.fn(),
  buildQuotationDocument: vi.fn(),
  buildPackingListDocument: vi.fn(),
}));

vi.mock('../services/orderService', () => ({
  createOrderFromQuotation: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const ADMIN_USER = {
  id: 'user-admin-1',
  email: 'admin@test.com',
  role: 'ADMIN',
  firstName: 'Admin',
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

const OPERATIONS_USER = {
  id: 'user-ops-1',
  email: 'ops@test.com',
  role: 'OPERATIONS',
  firstName: 'Ops',
  lastName: 'User',
  status: 'ACTIVE',
};

const FINANCE_USER = {
  id: 'user-finance-1',
  email: 'finance@test.com',
  role: 'FINANCE',
  firstName: 'Finance',
  lastName: 'User',
  status: 'ACTIVE',
};

let app: Express;

beforeAll(async () => {
  const mod = await import('../app');
  app = mod.default;
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Inquiry Tests ──────────────────────────────────────────────────────────

describe('Inquiries', () => {
  describe('POST /api/inquiries', () => {
    it('creates inquiry with correct fields', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(SALES_USER);

      const createdInquiry = {
        id: 'inq-1',
        inquiryNumber: 'INQ-00001',
        buyerId: 'buyer-1',
        salesOwnerId: SALES_USER.id,
        createdById: SALES_USER.id,
        stage: 'NEW',
        priority: 'HIGH',
        source: 'Email',
        requirements: 'Need 500 units',
        buyer: { id: 'buyer-1', companyName: 'Buyer Corp' },
        items: [],
        createdAt: new Date(),
      };

      mockPrisma.inquiry.create.mockResolvedValue(createdInquiry);

      const token = createTestJwt(SALES_USER.id, 'SALES');
      const res = await request(app)
        .post('/api/inquiries')
        .set('Authorization', `Bearer ${token}`)
        .send({
          buyerId: 'buyer-1',
          priority: 'HIGH',
          source: 'Email',
          requirements: 'Need 500 units',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: 'inq-1',
        inquiryNumber: 'INQ-00001',
        buyerId: 'buyer-1',
        priority: 'HIGH',
      });

      // Verify prisma.inquiry.create was called with correct data shape
      expect(mockPrisma.inquiry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            buyerId: 'buyer-1',
            priority: 'HIGH',
            source: 'Email',
            requirements: 'Need 500 units',
            inquiryNumber: 'CODE-00001',
            salesOwnerId: SALES_USER.id,
            createdById: SALES_USER.id,
          }),
        })
      );
    });
  });

  describe('GET /api/inquiries', () => {
    it('returns list when authenticated', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(SALES_USER);

      const inquiryList = [
        { id: 'inq-1', inquiryNumber: 'INQ-00001', buyer: { id: 'b1', companyName: 'Corp A', code: 'CA' } },
        { id: 'inq-2', inquiryNumber: 'INQ-00002', buyer: { id: 'b2', companyName: 'Corp B', code: 'CB' } },
      ];
      mockPrisma.inquiry.findMany.mockResolvedValue(inquiryList);
      mockPrisma.inquiry.count.mockResolvedValue(2);

      const token = createTestJwt(SALES_USER.id, 'SALES');
      const res = await request(app)
        .get('/api/inquiries')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination).toMatchObject({ page: 1, total: 2 });
    });

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .get('/api/inquiries');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});

// ─── Quotation Tests ────────────────────────────────────────────────────────

describe('Quotations', () => {
  describe('POST /api/quotations', () => {
    it('creates quotation linked to inquiry', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(SALES_USER);

      const createdQuotation = {
        id: 'qt-1',
        quotationNumber: 'QT-00001',
        inquiryId: 'inq-1',
        buyerId: 'buyer-1',
        currencyId: 'cur-usd',
        incotermId: 'inco-1',
        status: 'DRAFT',
        subtotal: 5000,
        totalCost: 4000,
        totalMargin: 1000,
        marginPercent: 25,
        grandTotal: 5000,
        buyer: { id: 'buyer-1', companyName: 'Buyer Corp' },
        currency: { id: 'cur-usd', code: 'USD', symbol: '$' },
        incoterm: { id: 'inco-1', code: 'FOB' },
        items: [{ id: 'item-1', productId: 'prod-1', quantity: 100, unitPrice: 50, product: { name: 'Widget' } }],
        costs: [],
        createdAt: new Date(),
      };

      mockPrisma.quotation.create.mockResolvedValue(createdQuotation);
      mockPrisma.inquiry.update.mockResolvedValue({});

      const token = createTestJwt(SALES_USER.id, 'SALES');
      const res = await request(app)
        .post('/api/quotations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          inquiryId: 'inq-1',
          buyerId: 'buyer-1',
          currencyId: 'cur-usd',
          incotermId: 'inco-1',
          validUntil: '2025-06-01',
          items: [
            { productId: 'prod-1', quantity: 100, unit: 'PCS', unitCost: 40, unitPrice: 50 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: 'qt-1',
        quotationNumber: 'QT-00001',
        inquiryId: 'inq-1',
        buyerId: 'buyer-1',
      });

      // Verify inquiry stage was updated since inquiryId was provided
      expect(mockPrisma.inquiry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inq-1' },
          data: { stage: 'QUOTATION_SENT' },
        })
      );
    });
  });

  describe('GET /api/quotations/:id', () => {
    it('returns quotation detail', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(SALES_USER);

      const quotationDetail = {
        id: 'qt-1',
        quotationNumber: 'QT-00001',
        inquiryId: 'inq-1',
        buyerId: 'buyer-1',
        status: 'SENT',
        subtotal: 5000,
        grandTotal: 5000,
        buyer: { id: 'buyer-1', companyName: 'Buyer Corp', country: null, contacts: [] },
        inquiry: { id: 'inq-1', inquiryNumber: 'INQ-00001' },
        currency: { id: 'cur-usd', code: 'USD', symbol: '$' },
        incoterm: { id: 'inco-1', code: 'FOB' },
        portOfLoading: null,
        portOfDischarge: null,
        items: [{ id: 'item-1', productId: 'prod-1', quantity: 100, unitPrice: 50, product: { name: 'Widget' } }],
        costs: [],
        orders: [],
      };

      mockPrisma.quotation.findUnique.mockResolvedValue(quotationDetail);

      const token = createTestJwt(SALES_USER.id, 'SALES');
      const res = await request(app)
        .get('/api/quotations/qt-1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: 'qt-1',
        quotationNumber: 'QT-00001',
        items: expect.any(Array),
      });
    });
  });
});

// ─── Order Tests ────────────────────────────────────────────────────────────

describe('Orders', () => {
  describe('POST /api/orders', () => {
    it('creates order from quotation', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(OPERATIONS_USER);

      const { createOrderFromQuotation } = await import('../services/orderService');
      const mockCreateOrder = vi.mocked(createOrderFromQuotation);

      const createdOrder = {
        id: 'order-1',
        orderNumber: 'ORD-00001',
        quotationId: 'qt-1',
        buyerId: 'buyer-1',
        status: 'CONFIRMED',
        totalValue: 5000,
        currency: 'USD',
        buyer: { id: 'buyer-1', companyName: 'Buyer Corp' },
        items: [],
        createdAt: new Date(),
      };

      mockCreateOrder.mockResolvedValue(createdOrder as any);

      const token = createTestJwt(OPERATIONS_USER.id, 'OPERATIONS');
      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          quotationId: 'qt-1',
          expectedDate: '2025-03-15',
          poNumber: 'PO-001',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: 'order-1',
        orderNumber: 'ORD-00001',
      });

      expect(mockCreateOrder).toHaveBeenCalledWith(
        'qt-1',
        expect.objectContaining({
          poNumber: 'PO-001',
        })
      );
    });
  });

  describe('GET /api/orders/:id', () => {
    it('returns order detail', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(OPERATIONS_USER);

      const orderDetail = {
        id: 'order-1',
        orderNumber: 'ORD-00001',
        quotationId: 'qt-1',
        buyerId: 'buyer-1',
        status: 'CONFIRMED',
        totalValue: 5000,
        currency: 'USD',
        buyer: { id: 'buyer-1', companyName: 'Buyer Corp', country: null },
        quotation: { id: 'qt-1', quotationNumber: 'QT-00001' },
        incoterm: { id: 'inco-1', code: 'FOB' },
        items: [],
        procurements: [],
        documents: [],
        shipments: [],
        portOfLoading: null,
        portOfDischarge: null,
        invoices: [],
      };

      mockPrisma.exportOrder.findUnique.mockResolvedValue(orderDetail);

      const token = createTestJwt(OPERATIONS_USER.id, 'OPERATIONS');
      const res = await request(app)
        .get('/api/orders/order-1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: 'order-1',
        orderNumber: 'ORD-00001',
        status: 'CONFIRMED',
        items: expect.any(Array),
      });
    });
  });
});

// ─── Invoice Tests ──────────────────────────────────────────────────────────

describe('Invoices', () => {
  describe('POST /api/invoices', () => {
    it('creates invoice from order', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(FINANCE_USER);

      const mockOrder = {
        id: 'order-1',
        orderNumber: 'ORD-00001',
        buyerId: 'buyer-1',
        currency: 'USD',
        totalValue: 5000,
        buyer: { id: 'buyer-1', companyName: 'Buyer Corp' },
      };

      const mockCurrency = { id: 'cur-usd', code: 'USD', symbol: '$', isBaseCurrency: false };
      const mockBaseCurrency = { id: 'cur-inr', code: 'INR', symbol: '₹', isBaseCurrency: true };

      mockPrisma.exportOrder.findUnique.mockResolvedValue(mockOrder);
      // First call: findFirst for the order currency, second call: findFirst for base currency
      mockPrisma.currency.findFirst
        .mockResolvedValueOnce(mockCurrency)
        .mockResolvedValueOnce(mockBaseCurrency);

      const createdInvoice = {
        id: 'inv-1',
        invoiceNumber: 'INV-00001',
        orderId: 'order-1',
        buyerId: 'buyer-1',
        currencyId: 'cur-usd',
        type: 'EXPORT',
        status: 'DRAFT',
        totalAmount: 5000,
        balanceAmount: 5000,
        paidAmount: 0,
        exchangeRate: 83.5,
        buyer: { id: 'buyer-1', companyName: 'Buyer Corp' },
        order: mockOrder,
        currency: mockCurrency,
        createdAt: new Date(),
      };

      mockPrisma.invoice.create.mockResolvedValue(createdInvoice);

      const token = createTestJwt(FINANCE_USER.id, 'FINANCE');
      const res = await request(app)
        .post('/api/invoices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          orderId: 'order-1',
          dueDate: '2025-03-01',
          type: 'EXPORT',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: 'inv-1',
        invoiceNumber: 'INV-00001',
        orderId: 'order-1',
        type: 'EXPORT',
      });

      // Verify prisma.invoice.create was called with correct data
      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'order-1',
            buyerId: 'buyer-1',
            currencyId: 'cur-usd',
            type: 'EXPORT',
            totalAmount: 5000,
            balanceAmount: 5000,
          }),
        })
      );
    });
  });

  describe('GET /api/invoices/:id', () => {
    it('returns invoice detail with payments', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(FINANCE_USER);

      const invoiceDetail = {
        id: 'inv-1',
        invoiceNumber: 'INV-00001',
        orderId: 'order-1',
        buyerId: 'buyer-1',
        currencyId: 'cur-usd',
        type: 'EXPORT',
        status: 'PARTIALLY_PAID',
        totalAmount: 10000,
        paidAmount: 3000,
        balanceAmount: 7000,
        buyer: { id: 'buyer-1', companyName: 'Buyer Corp', country: null },
        order: { id: 'order-1', items: [] },
        currency: { id: 'cur-usd', code: 'USD', symbol: '$' },
        payments: [
          { id: 'pay-1', paymentNumber: 'PAY-00001', amount: 3000, paymentDate: new Date() },
        ],
      };

      mockPrisma.invoice.findUnique.mockResolvedValue(invoiceDetail);

      const token = createTestJwt(FINANCE_USER.id, 'FINANCE');
      const res = await request(app)
        .get('/api/invoices/inv-1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: 'inv-1',
        invoiceNumber: 'INV-00001',
        status: 'PARTIALLY_PAID',
      });
      expect(res.body.data.payments).toBeDefined();
      expect(Array.isArray(res.body.data.payments)).toBe(true);
      expect(res.body.data.payments).toHaveLength(1);
      expect(res.body.data.payments[0]).toMatchObject({
        id: 'pay-1',
        paymentNumber: 'PAY-00001',
        amount: 3000,
      });
    });
  });
});
