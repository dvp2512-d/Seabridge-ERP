import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { AppError, ValidationError } from '../middleware/errorHandler';
import { authenticate, can } from '../middleware/auth';
import {
  createTokenPair,
  refreshTokens,
  revokeAllUserTokens,
  signAccessToken,
  getUserSessions,
} from '../services/refreshTokenService';

const router: Router = Router();

/**
 * Extract client info from request for session tracking
 */
function getClientInfo(req: any) {
  return {
    userAgent: req.headers['user-agent'] as string | undefined,
    ipAddress:
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress,
  };
}

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Password complexity requirements:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * 
 * These requirements balance security with usability for business users.
 */
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const registerSchema = z.object({
  email: z.string().email('Invalid email'),
  password: passwordSchema,
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  role: z.enum(['FOUNDER', 'SALES', 'OPERATIONS', 'FINANCE', 'ADMIN']).optional(),
  // The Add User form collects a phone number; without it here it was stripped.
  phone: z.string().optional(),
});

// Login
router.post('/login', async (req, res, next) => {
  try {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      throw new ValidationError(validation.error.errors);
    }

    const { email, password } = validation.data;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new AppError('Invalid credentials', 401);
    }

    if (user.status !== 'ACTIVE') {
      throw new AppError('Account is not active', 401);
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new AppError('Invalid credentials', 401);
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Create token pair (access + refresh)
    const { userAgent, ipAddress } = getClientInfo(req);
    const tokens = await createTokenPair(user.id, undefined, userAgent, ipAddress);

    res.json({
      success: true,
      data: {
        token: tokens.accessToken, // For backward compatibility
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// Register new user (requires authentication and USER_MANAGE permission)
// In production, only existing admins/founders can create new users
router.post('/register', authenticate, can('USER_MANAGE'), async (req: any, res, next) => {
  try {
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
      throw new ValidationError(validation.error.errors);
    }

    const { email, password, firstName, lastName, role, phone } = validation.data;

    // Only FOUNDER can create other FOUNDERs (prevent privilege escalation)
    if (role === 'FOUNDER' && req.user.role !== 'FOUNDER') {
      throw new AppError('Only a Founder can create another Founder account', 403);
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new AppError('Email already registered', 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        phone,
        role: role || 'SALES',
      },
    });

    // Create token pair for the new user
    const { userAgent, ipAddress } = getClientInfo(req);
    const tokens = await createTokenPair(user.id, undefined, userAgent, ipAddress);

    res.status(201).json({
      success: true,
      data: {
        token: tokens.accessToken,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get current user
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        phone: true,
        avatar: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
});

// Update your own profile.
//
// Deliberately limited to display details: role, status and email are not
// editable here, because changing your own role is how a founder locks the
// business out of its own settings. Those go through /api/users, which requires
// USER_MANAGE. The id comes from the token, never the body, so this route can
// only ever modify the caller's own row.
router.patch('/me', authenticate, async (req, res, next) => {
  try {
    const schema = z.object({
      firstName: z.string().min(1).optional(),
      lastName: z.string().min(1).optional(),
      phone: z.string().optional().nullable(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: validation.data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        phone: true,
      },
    });

    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// Change password
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: passwordSchema,
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      throw new ValidationError(validation.error.errors);
    }

    const { currentPassword, newPassword } = validation.data;

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValidPassword) {
      throw new AppError('Current password is incorrect', 400);
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Revoke all existing tokens (security: password change invalidates all sessions)
    await revokeAllUserTokens(user.id);

    // Create new token pair so user stays logged in
    const { userAgent, ipAddress } = getClientInfo(req);
    const tokens = await createTokenPair(user.id, undefined, userAgent, ipAddress);

    res.json({
      success: true,
      message: 'Password changed successfully',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Refresh tokens - exchange refresh token for new token pair
router.post('/refresh', async (req, res, next) => {
  try {
    const schema = z.object({
      refreshToken: z.string().min(1, 'Refresh token is required'),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      throw new ValidationError(validation.error.errors);
    }

    const { userAgent, ipAddress } = getClientInfo(req);
    const tokens = await refreshTokens(validation.data.refreshToken, userAgent, ipAddress);

    if (!tokens) {
      throw new AppError('Invalid or expired refresh token', 401);
    }

    res.json({
      success: true,
      data: {
        token: tokens.accessToken,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Logout - revoke all refresh tokens for the user
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const revokedCount = await revokeAllUserTokens(req.user!.id);

    res.json({
      success: true,
      message: 'Logged out successfully',
      data: { revokedSessions: revokedCount },
    });
  } catch (error) {
    next(error);
  }
});

// Get active sessions for current user
router.get('/sessions', authenticate, async (req, res, next) => {
  try {
    const sessions = await getUserSessions(req.user!.id);

    res.json({
      success: true,
      data: sessions,
    });
  } catch (error) {
    next(error);
  }
});

// Revoke a specific session
router.delete('/sessions/:sessionId', authenticate, async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    // Find the session and verify it belongs to the user
    const session = await prisma.refreshToken.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.userId !== req.user!.id) {
      throw new AppError('Session not found', 404);
    }

    if (session.revokedAt) {
      throw new AppError('Session already revoked', 400);
    }

    await prisma.refreshToken.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    res.json({
      success: true,
      message: 'Session revoked successfully',
    });
  } catch (error) {
    next(error);
  }
});

export { router as authRouter };
