/**
 * Redis Service
 * 
 * Provides Redis connectivity for:
 * - Distributed rate limiting (multi-instance deployments)
 * - Session caching
 * - General caching
 * 
 * Falls back gracefully when Redis is not available - the application
 * continues to work with in-memory alternatives.
 */
import Redis from 'ioredis';
import { RedisStore } from 'rate-limit-redis';
import { logger } from '../utils/logger';

let redisClient: Redis | null = null;
let connectionAttempted = false;

/**
 * Get or create Redis client.
 * Returns null if Redis is not configured or unavailable.
 */
export async function getRedisClient(): Promise<Redis | null> {
  if (connectionAttempted) {
    return redisClient;
  }
  
  connectionAttempted = true;
  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    logger.info('Redis not configured (REDIS_URL not set) - using in-memory fallbacks');
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.warn('Redis connection failed after 3 retries - falling back to in-memory');
          return null; // Stop retrying
        }
        return Math.min(times * 100, 3000); // Exponential backoff
      },
    });

    // Test connection
    await redisClient.ping();
    
    logger.info('Redis connected successfully');

    // Handle connection errors after initial connect
    redisClient.on('error', (error) => {
      logger.error('Redis connection error', { error: error.message });
    });

    redisClient.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });

    return redisClient;
  } catch (error) {
    logger.warn('Redis connection failed - using in-memory fallbacks', { 
      error: (error as Error).message 
    });
    redisClient = null;
    return null;
  }
}

/**
 * Close Redis connection gracefully
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    connectionAttempted = false;
    logger.info('Redis connection closed');
  }
}

/**
 * Redis store for rate-limit-redis
 * Export the class so it can be used in index.ts
 */
export { RedisStore };

/**
 * Simple cache operations with Redis fallback to no-op
 */
export const cache = {
  /**
   * Get a cached value
   */
  async get<T>(key: string): Promise<T | null> {
    if (!redisClient) return null;
    try {
      const value = await redisClient.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Cache get failed', { key, error: (error as Error).message });
      return null;
    }
  },

  /**
   * Set a cached value with optional TTL (in seconds)
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    if (!redisClient) return false;
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await redisClient.setex(key, ttlSeconds, serialized);
      } else {
        await redisClient.set(key, serialized);
      }
      return true;
    } catch (error) {
      logger.error('Cache set failed', { key, error: (error as Error).message });
      return false;
    }
  },

  /**
   * Delete a cached value
   */
  async del(key: string): Promise<boolean> {
    if (!redisClient) return false;
    try {
      await redisClient.del(key);
      return true;
    } catch (error) {
      logger.error('Cache del failed', { key, error: (error as Error).message });
      return false;
    }
  },

  /**
   * Delete all keys matching a pattern
   */
  async delPattern(pattern: string): Promise<number> {
    if (!redisClient) return 0;
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length === 0) return 0;
      return await redisClient.del(...keys);
    } catch (error) {
      logger.error('Cache delPattern failed', { pattern, error: (error as Error).message });
      return 0;
    }
  },

  /**
   * Check if Redis is connected
   */
  isConnected(): boolean {
    return redisClient !== null && redisClient.status === 'ready';
  },
};

/**
 * Distributed lock for coordinating scheduled jobs across multiple instances.
 * 
 * Uses SET NX (set if not exists) with expiration for simple but effective locking.
 * If Redis is not available, returns true to allow single-instance operation.
 */
export const distributedLock = {
  /**
   * Attempt to acquire a lock.
   * @param lockName - Unique name for the lock (e.g., 'job:token-cleanup')
   * @param ttlMs - Lock expiration in milliseconds (default 60s)
   * @returns true if lock acquired, false if already held by another instance
   */
  async acquire(lockName: string, ttlMs: number = 60000): Promise<boolean> {
    if (!redisClient) {
      // No Redis = single instance mode, always acquire
      return true;
    }
    try {
      // SET NX with PX (milliseconds expiry)
      // Returns 'OK' if set, null if key already exists
      const result = await redisClient.set(
        `lock:${lockName}`,
        Date.now().toString(),
        'PX',
        ttlMs,
        'NX'
      );
      return result === 'OK';
    } catch (error) {
      logger.error('Lock acquire failed', { lockName, error: (error as Error).message });
      // On error, allow operation to proceed (fail-open for availability)
      return true;
    }
  },

  /**
   * Release a lock.
   * @param lockName - Unique name for the lock
   */
  async release(lockName: string): Promise<void> {
    if (!redisClient) return;
    try {
      await redisClient.del(`lock:${lockName}`);
    } catch (error) {
      logger.error('Lock release failed', { lockName, error: (error as Error).message });
    }
  },

  /**
   * Execute a function with a distributed lock.
   * Only one instance across the cluster will execute the function.
   * 
   * @param lockName - Unique name for the lock
   * @param fn - Function to execute if lock is acquired
   * @param ttlMs - Lock expiration in milliseconds
   * @returns Result of fn if lock acquired, undefined otherwise
   */
  async withLock<T>(
    lockName: string,
    fn: () => Promise<T>,
    ttlMs: number = 60000
  ): Promise<T | undefined> {
    const acquired = await this.acquire(lockName, ttlMs);
    if (!acquired) {
      logger.debug('Lock not acquired, skipping', { lockName });
      return undefined;
    }
    try {
      return await fn();
    } finally {
      await this.release(lockName);
    }
  },
};
