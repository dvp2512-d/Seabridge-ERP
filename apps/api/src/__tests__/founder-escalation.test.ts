/**
 * P0-001: FOUNDER Privilege Escalation Tests
 *
 * These tests verify that:
 * - Only FOUNDER users can create new FOUNDER accounts
 * - Only FOUNDER users can promote existing users to FOUNDER
 * - ADMIN users cannot escalate privileges to FOUNDER
 * - Other roles (SALES, OPERATIONS, FINANCE) cannot manage users at all
 * - Legitimate ADMIN user management (non-FOUNDER roles) still works
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
    findMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
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
// Mock users for different roles
// ---------------------------------------------------------------------------
const FOUNDER_USER = {
  id: 'founder-001',
  email: 'founder@seabridge.com',
  firstName: 'Founder',
  lastName: 'User',
  role: 'FOUNDER' as const,
  status: 'ACTIVE' as const,
};

const ADMIN_USER = {
  id: 'admin-001',
  email: 'admin@seabridge.com',
  firstName: 'Admin',
  lastName: 'User',
  role: 'ADMIN' as const,
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

const TARGET_USER = {
  id: 'target-001',
  email: 'target@seabridge.com',
  firstName: 'Target',
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
// POST /api/users — CREATE USER WITH FOUNDER ROLE
// ===========================================================================
describe('POST /api/users — FOUNDER role creation (P0-001)', () => {
  it('ADMIN cannot create a user with FOUNDER role — returns 403', async () => {
    const token = createTestJwt(ADMIN_USER.id, 'ADMIN');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce(ADMIN_USER);

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'newfounder@seabridge.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'Founder',
        role: 'FOUNDER',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Only a Founder can create another Founder account');
    // Verify create was never called
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('FOUNDER can create a user with FOUNDER role — returns 201', async () => {
    const token = createTestJwt(FOUNDER_USER.id, 'FOUNDER');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce(FOUNDER_USER);

    // create user response
    mockPrisma.user.create.mockResolvedValue({
      id: 'new-founder-001',
      email: 'newfounder@seabridge.com',
      firstName: 'New',
      lastName: 'Founder',
      role: 'FOUNDER',
      status: 'ACTIVE',
    });

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'newfounder@seabridge.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'Founder',
        role: 'FOUNDER',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('FOUNDER');
    expect(mockPrisma.user.create).toHaveBeenCalled();
  });

  it('ADMIN can still create non-FOUNDER users (SALES) — returns 201', async () => {
    const token = createTestJwt(ADMIN_USER.id, 'ADMIN');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce(ADMIN_USER);

    // create user response
    mockPrisma.user.create.mockResolvedValue({
      id: 'new-sales-001',
      email: 'newsales@seabridge.com',
      firstName: 'New',
      lastName: 'Sales',
      role: 'SALES',
      status: 'ACTIVE',
    });

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'newsales@seabridge.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'Sales',
        role: 'SALES',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('SALES');
  });

  it('ADMIN can create ADMIN users — returns 201', async () => {
    const token = createTestJwt(ADMIN_USER.id, 'ADMIN');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce(ADMIN_USER);

    // create user response
    mockPrisma.user.create.mockResolvedValue({
      id: 'new-admin-001',
      email: 'newadmin@seabridge.com',
      firstName: 'New',
      lastName: 'Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    });

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'newadmin@seabridge.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'Admin',
        role: 'ADMIN',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('ADMIN');
  });

  it('SALES cannot create any users — returns 403 (no USER_MANAGE permission)', async () => {
    const token = createTestJwt(SALES_USER.id, 'SALES');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce(SALES_USER);

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'newuser@seabridge.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'User',
        role: 'SALES',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('OPERATIONS cannot create any users — returns 403', async () => {
    const token = createTestJwt(OPERATIONS_USER.id, 'OPERATIONS');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce(OPERATIONS_USER);

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'newuser@seabridge.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'User',
        role: 'SALES',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('FINANCE cannot create any users — returns 403', async () => {
    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce(FINANCE_USER);

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'newuser@seabridge.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'User',
        role: 'SALES',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

// ===========================================================================
// PUT /api/users/:id — PROMOTE USER TO FOUNDER ROLE
// ===========================================================================
describe('PUT /api/users/:id — FOUNDER role promotion (P0-001)', () => {
  it('ADMIN cannot promote a user to FOUNDER role — returns 403', async () => {
    const token = createTestJwt(ADMIN_USER.id, 'ADMIN');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce(ADMIN_USER);

    const res = await request(app)
      .put(`/api/users/${TARGET_USER.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        role: 'FOUNDER',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Only a Founder can promote a user to Founder');
    // Verify update was never called
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('FOUNDER can promote a user to FOUNDER role — returns 200', async () => {
    const token = createTestJwt(FOUNDER_USER.id, 'FOUNDER');

    // authenticate middleware
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(FOUNDER_USER)
      // For the losesActiveFounder check
      .mockResolvedValueOnce(TARGET_USER);

    // update user response
    mockPrisma.user.update.mockResolvedValue({
      ...TARGET_USER,
      role: 'FOUNDER',
    });

    const res = await request(app)
      .put(`/api/users/${TARGET_USER.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        role: 'FOUNDER',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('FOUNDER');
    expect(mockPrisma.user.update).toHaveBeenCalled();
  });

  it('ADMIN can still update non-FOUNDER fields (firstName) — returns 200', async () => {
    const token = createTestJwt(ADMIN_USER.id, 'ADMIN');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce(ADMIN_USER);

    // update user response
    mockPrisma.user.update.mockResolvedValue({
      ...TARGET_USER,
      firstName: 'Updated',
    });

    const res = await request(app)
      .put(`/api/users/${TARGET_USER.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Updated',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.firstName).toBe('Updated');
  });

  it('ADMIN can change user role to non-FOUNDER roles (SALES to ADMIN) — returns 200', async () => {
    const token = createTestJwt(ADMIN_USER.id, 'ADMIN');

    // authenticate middleware
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(ADMIN_USER)
      // For the losesActiveFounder check
      .mockResolvedValueOnce(TARGET_USER);

    // update user response
    mockPrisma.user.update.mockResolvedValue({
      ...TARGET_USER,
      role: 'ADMIN',
    });

    const res = await request(app)
      .put(`/api/users/${TARGET_USER.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        role: 'ADMIN',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('ADMIN');
  });

  it('ADMIN can change user role to OPERATIONS — returns 200', async () => {
    const token = createTestJwt(ADMIN_USER.id, 'ADMIN');

    // authenticate middleware
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(ADMIN_USER)
      // For the losesActiveFounder check
      .mockResolvedValueOnce(TARGET_USER);

    // update user response
    mockPrisma.user.update.mockResolvedValue({
      ...TARGET_USER,
      role: 'OPERATIONS',
    });

    const res = await request(app)
      .put(`/api/users/${TARGET_USER.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        role: 'OPERATIONS',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('OPERATIONS');
  });

  it('SALES cannot update any users — returns 403', async () => {
    const token = createTestJwt(SALES_USER.id, 'SALES');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce(SALES_USER);

    const res = await request(app)
      .put(`/api/users/${TARGET_USER.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Updated',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('OPERATIONS cannot update any users — returns 403', async () => {
    const token = createTestJwt(OPERATIONS_USER.id, 'OPERATIONS');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce(OPERATIONS_USER);

    const res = await request(app)
      .put(`/api/users/${TARGET_USER.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Updated',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('FINANCE cannot update any users — returns 403', async () => {
    const token = createTestJwt(FINANCE_USER.id, 'FINANCE');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce(FINANCE_USER);

    const res = await request(app)
      .put(`/api/users/${TARGET_USER.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Updated',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

// ===========================================================================
// EDGE CASES
// ===========================================================================
describe('Edge cases — privilege escalation prevention', () => {
  it('ADMIN cannot promote themselves to FOUNDER — returns 403', async () => {
    const token = createTestJwt(ADMIN_USER.id, 'ADMIN');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce(ADMIN_USER);

    const res = await request(app)
      .put(`/api/users/${ADMIN_USER.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        role: 'FOUNDER',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Only a Founder can promote a user to Founder');
  });

  it('Request without role field does not trigger FOUNDER check — returns 200', async () => {
    const token = createTestJwt(ADMIN_USER.id, 'ADMIN');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce(ADMIN_USER);

    // update user response
    mockPrisma.user.update.mockResolvedValue({
      ...TARGET_USER,
      firstName: 'Updated',
      lastName: 'Name',
    });

    const res = await request(app)
      .put(`/api/users/${TARGET_USER.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Updated',
        lastName: 'Name',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('FOUNDER changing another FOUNDER to ADMIN still works (for demotion)', async () => {
    const token = createTestJwt(FOUNDER_USER.id, 'FOUNDER');
    const anotherFounder = {
      ...FOUNDER_USER,
      id: 'founder-002',
      email: 'founder2@seabridge.com',
    };

    // authenticate middleware
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(FOUNDER_USER)
      // For losesActiveFounder check
      .mockResolvedValueOnce(anotherFounder);

    // Count check for last active founder protection
    mockPrisma.user.count.mockResolvedValue(2);

    // update user response
    mockPrisma.user.update.mockResolvedValue({
      ...anotherFounder,
      role: 'ADMIN',
    });

    const res = await request(app)
      .put(`/api/users/${anotherFounder.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        role: 'ADMIN',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('ADMIN');
  });
});
