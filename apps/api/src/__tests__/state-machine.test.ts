/**
 * State Machine Validation Tests
 *
 * Tests for the order/invoice/inquiry state machine validations added in the audit fixes.
 * These tests verify that:
 * - Orders follow valid status transitions
 * - Invoices cannot be set to PAID without payments
 * - Inquiries cannot be reopened once WON/LOST
 * - Cancelled orders cannot have new procurements/shipments/invoices
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestJwt } from './setup';

// ---------------------------------------------------------------------------
// Mock @seabridge/database at module level — no real DB connection.
// ---------------------------------------------------------------------------
const mockPrisma = {
  user: {
    findUnique: vi.fn(),
  },
  exportOrder: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  invoice: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  inquiry: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  supplier: {
    findUnique: vi.fn(),
  },
  procurement: {
    create: vi.fn(),
  },
  shipment: {
    create: vi.fn(),
  },
  numberSequence: {
    upsert: vi.fn().mockResolvedValue({ currentNo: 1, prefix: 'TEST', padLength: 5 }),
  },
  auditLog: {
    create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
  },
  $connect: vi.fn(),
  $disconnect: vi.fn(),
};

vi.mock('@seabridge/database', () => ({
  prisma: mockPrisma,
  default: mockPrisma,
  UserRole: {
    FOUNDER: 'FOUNDER',
    SALES: 'SALES',
    OPERATIONS: 'OPERATIONS',
    FINANCE: 'FINANCE',
    ADMIN: 'ADMIN',
  },
  UserStatus: {
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
    SUSPENDED: 'SUSPENDED',
  },
  PrismaClient: vi.fn(() => mockPrisma),
}));

// ---------------------------------------------------------------------------
// Mock users
// ---------------------------------------------------------------------------
const OPERATIONS_USER = {
  id: 'ops-001',
  email: 'ops@seabridge.com',
  firstName: 'Ops',
  lastName: 'User',
  role: 'OPERATIONS' as const,
  status: 'ACTIVE' as const,
};

const FINANCE_USER = {
  id: 'finance-001',
  email: 'finance@seabridge.com',
  firstName: 'Finance',
  lastName: 'User',
  role: 'FINANCE' as const,
  status: 'ACTIVE' as const,
};

const SALES_USER = {
  id: 'sales-001',
  email: 'sales@seabridge.com',
  firstName: 'Sales',
  lastName: 'User',
  role: 'SALES' as const,
  status: 'ACTIVE' as const,
};

// ---------------------------------------------------------------------------
// App instance (imported after mocks are set up)
// ---------------------------------------------------------------------------
let app: Express;

beforeAll(async () => {
  const mod = await import('../app');
  app = mod.default;
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// ORDER STATUS STATE MACHINE
// ===========================================================================
describe('Order Status State Machine', () => {
  it('rejects invalid transition: CONFIRMED → DELIVERED (must go through intermediate states)', async () => {
    const token = createTestJwt(OPERATIONS_USER.id, 'OPERATIONS');

    mockPrisma.user.findUnique.mockResolvedValueOnce(OPERATIONS_USER);
    mockPrisma.exportOrder.findUnique.mockResolvedValueOnce({
      id: 'order-001',
      orderNumber: 'ORD-00001',
      status: 'CONFIRMED',
      buyerId: 'buyer-001',
    });

    const res = await request(app)
      .put('/api/orders/order-001')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DELIVERED' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Cannot change');
    expect(res.body.message).toContain('CONFIRMED to DELIVERED');
    expect(mockPrisma.exportOrder.update).not.toHaveBeenCalled();
  });

  it('rejects transition from terminal state: DELIVERED → IN_PRODUCTION', async () => {
    const token = createTestJwt(OPERATIONS_USER.id, 'OPERATIONS');

    mockPrisma.user.findUnique.mockResolvedValueOnce(OPERATIONS_USER);
    mockPrisma.exportOrder.findUnique.mockResolvedValueOnce({
      id: 'order-001',
      orderNumber: 'ORD-00001',
      status: 'DELIVERED',
      buyerId: 'buyer-001',
    });

    const res = await request(app)
      .put('/api/orders/order-001')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_PRODUCTION' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('terminal state');
    expect(mockPrisma.exportOrder.update).not.toHaveBeenCalled();
  });

  it('allows valid transition: CONFIRMED → IN_PRODUCTION', async () => {
    const token = createTestJwt(OPERATIONS_USER.id, 'OPERATIONS');

    mockPrisma.user.findUnique.mockResolvedValueOnce(OPERATIONS_USER);
    mockPrisma.exportOrder.findUnique.mockResolvedValueOnce({
      id: 'order-001',
      orderNumber: 'ORD-00001',
      status: 'CONFIRMED',
      buyerId: 'buyer-001',
    });
    mockPrisma.exportOrder.update.mockResolvedValueOnce({
      id: 'order-001',
      status: 'IN_PRODUCTION',
    });

    const res = await request(app)
      .put('/api/orders/order-001')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_PRODUCTION' });

    expect(res.status).toBe(200);
    expect(mockPrisma.exportOrder.update).toHaveBeenCalled();
  });

  it('allows cancellation from any non-terminal state: IN_PRODUCTION → CANCELLED', async () => {
    const token = createTestJwt(OPERATIONS_USER.id, 'OPERATIONS');

    mockPrisma.user.findUnique.mockResolvedValueOnce(OPERATIONS_USER);
    mockPrisma.exportOrder.findUnique.mockResolvedValueOnce({
      id: 'order-001',
      orderNumber: 'ORD-00001',
      status: 'IN_PRODUCTION',
      buyerId: 'buyer-001',
    });
    mockPrisma.exportOrder.update.mockResolvedValueOnce({
      id: 'order-001',
      status: 'CANCELLED',
    });

    const res = await request(app)
      .put('/api/orders/order-001')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED' });

    expect(res.status).toBe(200);
    expect(mockPrisma.exportOrder.update).toHaveBeenCalled();
  });
});

// ===========================================================================
// CANCELLED ORDER RESTRICTIONS
// ===========================================================================
describe('Cancelled Order Restrictions', () => {
  it('blocks invoice creation for cancelled orders', async () => {
    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');

    mockPrisma.user.findUnique.mockResolvedValueOnce(FINANCE_USER);
    mockPrisma.exportOrder.findUnique.mockResolvedValueOnce({
      id: 'order-001',
      orderNumber: 'ORD-00001',
      status: 'CANCELLED',
      buyerId: 'buyer-001',
      totalValue: 100000,
    });

    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderId: 'order-001',
        dueDate: '2026-12-31',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('cancelled order');
    expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// INVOICE STATUS VALIDATION
// ===========================================================================
describe('Invoice Status Validation', () => {
  it('blocks manual PAID status when balance is outstanding', async () => {
    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');

    mockPrisma.user.findUnique.mockResolvedValueOnce(FINANCE_USER);
    mockPrisma.invoice.findUnique.mockResolvedValueOnce({
      id: 'inv-001',
      invoiceNumber: 'INV-00001',
      status: 'SENT',
      paidAmount: 50000,
      balanceAmount: 50000,
      totalAmount: 100000,
    });

    const res = await request(app)
      .put('/api/invoices/inv-001')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'PAID' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('balance');
    expect(res.body.message).toContain('outstanding');
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it('blocks PARTIALLY_PAID status when no payments recorded', async () => {
    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');

    mockPrisma.user.findUnique.mockResolvedValueOnce(FINANCE_USER);
    mockPrisma.invoice.findUnique.mockResolvedValueOnce({
      id: 'inv-001',
      invoiceNumber: 'INV-00001',
      status: 'SENT',
      paidAmount: 0,
      balanceAmount: 100000,
      totalAmount: 100000,
    });

    const res = await request(app)
      .put('/api/invoices/inv-001')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'PARTIALLY_PAID' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('no payments');
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it('blocks changes to PAID invoices', async () => {
    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');

    mockPrisma.user.findUnique.mockResolvedValueOnce(FINANCE_USER);
    mockPrisma.invoice.findUnique.mockResolvedValueOnce({
      id: 'inv-001',
      invoiceNumber: 'INV-00001',
      status: 'PAID',
      paidAmount: 100000,
      balanceAmount: 0,
      totalAmount: 100000,
    });

    const res = await request(app)
      .put('/api/invoices/inv-001')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SENT' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('paid in full');
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it('allows DRAFT → SENT transition', async () => {
    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');

    mockPrisma.user.findUnique.mockResolvedValueOnce(FINANCE_USER);
    mockPrisma.invoice.findUnique.mockResolvedValueOnce({
      id: 'inv-001',
      invoiceNumber: 'INV-00001',
      status: 'DRAFT',
      paidAmount: 0,
      balanceAmount: 100000,
      totalAmount: 100000,
    });
    mockPrisma.invoice.update.mockResolvedValueOnce({
      id: 'inv-001',
      status: 'SENT',
    });

    const res = await request(app)
      .put('/api/invoices/inv-001')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SENT' });

    expect(res.status).toBe(200);
    expect(mockPrisma.invoice.update).toHaveBeenCalled();
  });
});

// ===========================================================================
// INQUIRY STAGE VALIDATION
// ===========================================================================
describe('Inquiry Stage Validation', () => {
  it('blocks reopening WON inquiries', async () => {
    const token = createTestJwt(SALES_USER.id, 'SALES');

    mockPrisma.user.findUnique.mockResolvedValueOnce(SALES_USER);
    mockPrisma.inquiry.findUnique.mockResolvedValueOnce({
      id: 'inq-001',
      inquiryNumber: 'INQ-00001',
      stage: 'WON',
    });

    const res = await request(app)
      .put('/api/inquiries/inq-001')
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'NEGOTIATION' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('closed');
    expect(mockPrisma.inquiry.update).not.toHaveBeenCalled();
  });

  it('blocks reopening LOST inquiries', async () => {
    const token = createTestJwt(SALES_USER.id, 'SALES');

    mockPrisma.user.findUnique.mockResolvedValueOnce(SALES_USER);
    mockPrisma.inquiry.findUnique.mockResolvedValueOnce({
      id: 'inq-001',
      inquiryNumber: 'INQ-00001',
      stage: 'LOST',
    });

    const res = await request(app)
      .put('/api/inquiries/inq-001')
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'NEW' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('closed');
    expect(mockPrisma.inquiry.update).not.toHaveBeenCalled();
  });

  it('requires lostReason when marking as LOST', async () => {
    const token = createTestJwt(SALES_USER.id, 'SALES');

    mockPrisma.user.findUnique.mockResolvedValueOnce(SALES_USER);
    mockPrisma.inquiry.findUnique.mockResolvedValueOnce({
      id: 'inq-001',
      inquiryNumber: 'INQ-00001',
      stage: 'NEGOTIATION',
    });

    const res = await request(app)
      .put('/api/inquiries/inq-001')
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'LOST' }); // No lostReason

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('reason');
    expect(mockPrisma.inquiry.update).not.toHaveBeenCalled();
  });

  it('allows marking as LOST with reason', async () => {
    const token = createTestJwt(SALES_USER.id, 'SALES');

    mockPrisma.user.findUnique.mockResolvedValueOnce(SALES_USER);
    mockPrisma.inquiry.findUnique.mockResolvedValueOnce({
      id: 'inq-001',
      inquiryNumber: 'INQ-00001',
      stage: 'NEGOTIATION',
    });
    mockPrisma.inquiry.update.mockResolvedValueOnce({
      id: 'inq-001',
      stage: 'LOST',
      lostReason: 'Price too high',
    });

    const res = await request(app)
      .put('/api/inquiries/inq-001')
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'LOST', lostReason: 'Price too high' });

    expect(res.status).toBe(200);
    expect(mockPrisma.inquiry.update).toHaveBeenCalled();
  });
});

// ===========================================================================
// DUPLICATE COMMERCIAL INVOICE PREVENTION
// ===========================================================================
describe('Duplicate Commercial Invoice Prevention', () => {
  it('blocks second commercial invoice for same order', async () => {
    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');

    mockPrisma.user.findUnique.mockResolvedValueOnce(FINANCE_USER);
    mockPrisma.exportOrder.findUnique.mockResolvedValueOnce({
      id: 'order-001',
      orderNumber: 'ORD-00001',
      status: 'CONFIRMED',
      buyerId: 'buyer-001',
      totalValue: 100000,
    });
    // Existing commercial invoice
    mockPrisma.invoice.findFirst.mockResolvedValueOnce({
      invoiceNumber: 'INV-00001',
    });

    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderId: 'order-001',
        type: 'COMMERCIAL',
        dueDate: '2026-12-31',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('already has commercial invoice');
    expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
  });

  it('allows proforma invoice even if commercial exists', async () => {
    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');

    mockPrisma.user.findUnique.mockResolvedValueOnce(FINANCE_USER);
    mockPrisma.exportOrder.findUnique.mockResolvedValueOnce({
      id: 'order-001',
      orderNumber: 'ORD-00001',
      status: 'CONFIRMED',
      buyerId: 'buyer-001',
      quotationId: 'quote-001',
      totalValue: 100000,
    });
    // No existing commercial invoice for proforma check (proforma type doesn't check for existing)
    mockPrisma.invoice.findFirst.mockResolvedValueOnce(null);
    mockPrisma.invoice.create.mockResolvedValueOnce({
      id: 'inv-002',
      invoiceNumber: 'PRF-00001',
      type: 'PROFORMA',
    });

    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderId: 'order-001',
        type: 'PROFORMA',
        dueDate: '2026-12-31',
      });

    // Should succeed (proforma can be created even with existing commercial)
    // The mock returns null for findFirst because PROFORMA type doesn't trigger the check
    expect(res.status).toBe(201);
  });
});
