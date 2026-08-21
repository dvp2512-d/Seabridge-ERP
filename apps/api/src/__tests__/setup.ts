import dotenv from 'dotenv';
import path from 'path';
import jwt from 'jsonwebtoken';

// Load .env.test if it exists, otherwise fall back to .env
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Ensure critical env vars are set for tests
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long-for-testing';
}

process.env.NODE_ENV = 'test';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://seabridge:seabridge@localhost:5432/seabridge_erp_test';
}

/**
 * Create a signed JWT for testing authenticated endpoints.
 */
export function createTestJwt(userId: string, role: string = 'ADMIN'): string {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' }
  );
}

/**
 * Import and return the configured Express app without starting the HTTP server.
 * Use this in integration tests with supertest.
 */
export async function makeApp() {
  const { default: app } = await import('../app');
  return app;
}
