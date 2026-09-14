/**
 * Refresh Token Service
 * 
 * Implements secure JWT refresh token rotation:
 * - Access tokens: Short-lived (15 minutes)
 * - Refresh tokens: Long-lived (7 days)
 * - Token rotation: New refresh token issued on each use
 * - Family tracking: Detects token reuse attacks
 * 
 * Security features:
 * - Refresh tokens are single-use
 * - Token families allow detecting stolen tokens
 * - If a revoked token is reused, entire family is invalidated
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '@seabridge/database';
import { logger } from '../utils/logger';

// Token expiration times
const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_DAYS = 7;

interface TokenPayload {
  userId: string;
  type: 'access' | 'refresh';
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until access token expires
}

/**
 * Generate a cryptographically secure random token
 */
function generateSecureToken(): string {
  return crypto.randomBytes(64).toString('base64url');
}

/**
 * Get JWT secret with validation
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be configured and at least 32 characters');
  }
  return secret;
}

/**
 * Sign an access token (short-lived)
 */
export function signAccessToken(userId: string): string {
  const payload: TokenPayload = { userId, type: 'access' };
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
}

/**
 * Create a new token pair (access + refresh)
 * 
 * @param userId - User ID to create tokens for
 * @param family - Token family (optional, creates new family if not provided)
 * @param userAgent - User agent string for tracking
 * @param ipAddress - IP address for tracking
 */
export async function createTokenPair(
  userId: string,
  family?: string,
  userAgent?: string,
  ipAddress?: string
): Promise<TokenPair> {
  const accessToken = signAccessToken(userId);
  const refreshToken = generateSecureToken();
  const tokenFamily = family || crypto.randomUUID();
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);
  
  await prisma.refreshToken.create({
    data: {
      userId,
      token: refreshToken,
      family: tokenFamily,
      expiresAt,
      userAgent: userAgent?.slice(0, 500), // Limit length
      ipAddress,
    },
  });
  
  return {
    accessToken,
    refreshToken,
    expiresIn: 15 * 60, // 15 minutes in seconds
  };
}

/**
 * Refresh tokens - exchange a valid refresh token for a new token pair
 * 
 * Implements token rotation:
 * 1. Find the refresh token
 * 2. Check if it's valid and not expired
 * 3. If already revoked, invalidate entire family (potential theft)
 * 4. Revoke current token
 * 5. Issue new token pair with same family
 */
export async function refreshTokens(
  refreshToken: string,
  userAgent?: string,
  ipAddress?: string
): Promise<TokenPair | null> {
  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  });
  
  if (!storedToken) {
    logger.warn('Refresh token not found', { tokenPrefix: refreshToken.slice(0, 10) });
    return null;
  }
  
  // Check if token was already revoked (potential token theft!)
  if (storedToken.revokedAt) {
    logger.error('Revoked refresh token reused - invalidating family', {
      userId: storedToken.userId,
      family: storedToken.family,
      tokenId: storedToken.id,
    });
    
    // Invalidate all tokens in this family
    await prisma.refreshToken.updateMany({
      where: { family: storedToken.family },
      data: { revokedAt: new Date() },
    });
    
    return null;
  }
  
  // Check if token is expired
  if (storedToken.expiresAt < new Date()) {
    logger.warn('Refresh token expired', { tokenId: storedToken.id });
    return null;
  }
  
  // Check if user is still active
  if (storedToken.user.status !== 'ACTIVE') {
    logger.warn('User account not active', { userId: storedToken.userId });
    return null;
  }
  
  // Create new token pair with same family
  const newPair = await createTokenPair(
    storedToken.userId,
    storedToken.family,
    userAgent,
    ipAddress
  );
  
  // Revoke the old token (mark as used)
  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: {
      revokedAt: new Date(),
      replacedBy: newPair.refreshToken,
    },
  });
  
  return newPair;
}

/**
 * Revoke all refresh tokens for a user
 * Used when user logs out, changes password, or is deactivated
 */
export async function revokeAllUserTokens(userId: string): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
  
  logger.info('Revoked all user tokens', { userId, count: result.count });
  return result.count;
}

/**
 * Revoke a specific token family
 * Used when suspicious activity is detected
 */
export async function revokeTokenFamily(family: string): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: {
      family,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
  
  logger.info('Revoked token family', { family, count: result.count });
  return result.count;
}

/**
 * Clean up expired refresh tokens
 * Should be run periodically (e.g., daily cron job)
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { revokedAt: { lt: thirtyDaysAgo } },
      ],
    },
  });
  
  logger.info('Cleaned up expired refresh tokens', { count: result.count });
  return result.count;
}

/**
 * Get active sessions for a user
 * Returns list of devices/sessions
 */
export async function getUserSessions(userId: string) {
  return prisma.refreshToken.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      userAgent: true,
      ipAddress: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}
