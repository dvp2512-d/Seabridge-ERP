import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
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
// Realistic mock data matching Prisma's return shapes
// ---------------------------------------------------------------------------
const MOCK_USER = {
  id: 'cluser00000001',
  email: 'founder@seabridge.com',
  passwordHash: '$2a$12$LJ3/9Y6kZ5TqXq8hHzVxGOKJ4Hw8.F5V3V7xPcm3Y9mK2wFHQx2u', // bcrypt of 'Password123!'
  firstName: 'Dhruvil',
  lastName: 'Patel',
  role: 'FOUNDER' as const,
  status: 'ACTIVE' as const,
  phone: '+91-9876543210',
  avatar: null,
  lastLoginAt: new Date('2026-08-20T10:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-08-20T10:00:00Z'),
};

const MOCK_SALES_USER = {
  id: 'cluser00000002',
  email: 'sales@seabridge.com',
  passwordHash: '$2a$12$LJ3/9Y6kZ5TqXq8hHzVxGOKJ4Hw8.F5V3V7xPcm3Y9mK2wFHQx2u',
  firstName: 'Ravi',
  lastName: 'Shah',
  role: 'SALES' as const,
  status: 'ACTIVE' as const,
  phone: '+91-9876543211',
  avatar: null,
  lastLoginAt: new Date('2026-08-19T08:00:00Z'),
  createdAt: new Date('2026-02-01T00:00:00Z'),
  updatedAt: new Date('2026-08-19T08:00:00Z'),
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
// AUTH — LOGIN
// ===========================================================================
describe('POST /api/auth/login', () => {
  it('POST /api/auth/login — valid credentials returns 200, token, and user object', async () => {
    // bcrypt.compare will be called with 'Password123!' against the hash
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('Password123!', 12);
    const userWithRealHash = { ...MOCK_USER, passwordHash: hash };

    mockPrisma.user.findUnique.mockResolvedValue(userWithRealHash);
    mockPrisma.user.update.mockResolvedValue({ ...userWithRealHash, lastLoginAt: new Date() });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'founder@seabridge.com', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.user).toMatchObject({
      id: MOCK_USER.id,
      email: MOCK_USER.email,
      firstName: MOCK_USER.firstName,
      lastName: MOCK_USER.lastName,
      role: 'FOUNDER',
    });
  });

  it('POST /api/auth/login — wrong password returns 401 with "Invalid credentials"', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('CorrectPassword', 12);
    const userWithRealHash = { ...MOCK_USER, passwordHash: hash };

    mockPrisma.user.findUnique.mockResolvedValue(userWithRealHash);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'founder@seabridge.com', password: 'WrongPassword' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('POST /api/auth/login — nonexistent email returns 401 (not 404, prevents enumeration)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@seabridge.com', password: 'SomePassword123' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('POST /api/auth/login — missing email returns 400 (validation)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'Password123!' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/auth/login — missing password returns 400 (validation)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'founder@seabridge.com' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ===========================================================================
// AUTH — /me
// ===========================================================================
describe('GET /api/auth/me', () => {
  it('GET /api/auth/me — without token returns 401', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/auth/me — with valid token returns user profile', async () => {
    const token = createTestJwt(MOCK_USER.id, 'FOUNDER');

    // authenticate middleware calls findUnique to load user
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({
        id: MOCK_USER.id,
        email: MOCK_USER.email,
        role: MOCK_USER.role,
        firstName: MOCK_USER.firstName,
        lastName: MOCK_USER.lastName,
        status: 'ACTIVE',
      })
      // The GET /me route itself also calls findUnique
      .mockResolvedValueOnce({
        id: MOCK_USER.id,
        email: MOCK_USER.email,
        firstName: MOCK_USER.firstName,
        lastName: MOCK_USER.lastName,
        role: MOCK_USER.role,
        phone: MOCK_USER.phone,
        avatar: MOCK_USER.avatar,
        lastLoginAt: MOCK_USER.lastLoginAt,
        createdAt: MOCK_USER.createdAt,
      });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(MOCK_USER.id);
    expect(res.body.data.email).toBe(MOCK_USER.email);
    expect(res.body.data.firstName).toBe(MOCK_USER.firstName);
  });

  it('GET /api/auth/me — malformed token returns 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not.a.valid.jwt.token');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ===========================================================================
// AUTH — CHANGE PASSWORD
// ===========================================================================
describe('POST /api/auth/change-password', () => {
  it('POST /api/auth/change-password — valid current password changes it', async () => {
    const bcrypt = await import('bcryptjs');
    const currentHash = await bcrypt.hash('OldPassword123!', 12);
    const token = createTestJwt(MOCK_USER.id, 'FOUNDER');

    // authenticate middleware lookup
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({
        id: MOCK_USER.id,
        email: MOCK_USER.email,
        role: MOCK_USER.role,
        firstName: MOCK_USER.firstName,
        lastName: MOCK_USER.lastName,
        status: 'ACTIVE',
      })
      // change-password route lookup
      .mockResolvedValueOnce({
        ...MOCK_USER,
        passwordHash: currentHash,
      });

    mockPrisma.user.update.mockResolvedValue({ ...MOCK_USER });

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword456!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Password changed successfully');
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MOCK_USER.id },
        data: expect.objectContaining({ passwordHash: expect.any(String) }),
      })
    );
  });

  it('POST /api/auth/change-password — wrong current password returns 400', async () => {
    const bcrypt = await import('bcryptjs');
    const currentHash = await bcrypt.hash('CorrectOldPassword', 12);
    const token = createTestJwt(MOCK_USER.id, 'FOUNDER');

    // authenticate middleware lookup
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({
        id: MOCK_USER.id,
        email: MOCK_USER.email,
        role: MOCK_USER.role,
        firstName: MOCK_USER.firstName,
        lastName: MOCK_USER.lastName,
        status: 'ACTIVE',
      })
      // change-password route lookup
      .mockResolvedValueOnce({
        ...MOCK_USER,
        passwordHash: currentHash,
      });

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongOldPassword', newPassword: 'NewPassword456!' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Current password is incorrect');
  });
});

// ===========================================================================
// USERS — PROTECTED ENDPOINT / RBAC
// ===========================================================================
describe('GET /api/users', () => {
  it('GET /api/users — without token returns 401', async () => {
    const res = await request(app).get('/api/users');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/users — with FOUNDER token succeeds', async () => {
    const token = createTestJwt(MOCK_USER.id, 'FOUNDER');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: MOCK_USER.id,
      email: MOCK_USER.email,
      role: 'FOUNDER',
      firstName: MOCK_USER.firstName,
      lastName: MOCK_USER.lastName,
      status: 'ACTIVE',
    });

    // users list query
    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: MOCK_USER.id,
        email: MOCK_USER.email,
        firstName: MOCK_USER.firstName,
        lastName: MOCK_USER.lastName,
        role: 'FOUNDER',
        status: 'ACTIVE',
        phone: MOCK_USER.phone,
        lastLoginAt: MOCK_USER.lastLoginAt,
        createdAt: MOCK_USER.createdAt,
      },
    ]);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/users — with SALES token returns 403 (RBAC — USER_VIEW is FOUNDER/ADMIN only)', async () => {
    const token = createTestJwt(MOCK_SALES_USER.id, 'SALES');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: MOCK_SALES_USER.id,
      email: MOCK_SALES_USER.email,
      role: 'SALES',
      firstName: MOCK_SALES_USER.firstName,
      lastName: MOCK_SALES_USER.lastName,
      status: 'ACTIVE',
    });

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/users', () => {
  it('POST /api/users — creating a user with FOUNDER role succeeds when caller is FOUNDER', async () => {
    const token = createTestJwt(MOCK_USER.id, 'FOUNDER');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: MOCK_USER.id,
      email: MOCK_USER.email,
      role: 'FOUNDER',
      firstName: MOCK_USER.firstName,
      lastName: MOCK_USER.lastName,
      status: 'ACTIVE',
    });

    // create user response
    mockPrisma.user.create.mockResolvedValue({
      id: 'cluser00000003',
      email: 'newuser@seabridge.com',
      firstName: 'New',
      lastName: 'User',
      role: 'FOUNDER',
      status: 'ACTIVE',
    });

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'newuser@seabridge.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'User',
        role: 'FOUNDER',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('FOUNDER');
  });

  it('POST /api/users — creating a user with FOUNDER role from SALES caller returns 403', async () => {
    const token = createTestJwt(MOCK_SALES_USER.id, 'SALES');

    // authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: MOCK_SALES_USER.id,
      email: MOCK_SALES_USER.email,
      role: 'SALES',
      firstName: MOCK_SALES_USER.firstName,
      lastName: MOCK_SALES_USER.lastName,
      status: 'ACTIVE',
    });

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'newuser@seabridge.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'User',
        role: 'FOUNDER',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

// ===========================================================================
// STATIC CHECKS
// ===========================================================================
describe('Static checks', () => {
  it('auth login route has authLimiter middleware applied', () => {
    const authRouteSource = fs.readFileSync(
      path.resolve(__dirname, '../routes/auth.ts'),
      'utf-8'
    );

    // Verify that the login route uses authLimiter
    expect(authRouteSource).toMatch(/router\.post\(['"]\/login['"],\s*authLimiter/);
  });

  it('index.ts validates JWT_SECRET at startup (process.exit if missing or short)', () => {
    const indexSource = fs.readFileSync(
      path.resolve(__dirname, '../index.ts'),
      'utf-8'
    );

    // Verify the validateEnv function exists and checks JWT_SECRET
    expect(indexSource).toContain('JWT_SECRET');
    expect(indexSource).toContain('process.exit(1)');
    expect(indexSource).toMatch(/jwtSecret\.length\s*<\s*32/);
  });
});
