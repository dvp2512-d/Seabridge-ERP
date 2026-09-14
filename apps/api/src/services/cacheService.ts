/**
 * Caching Service
 * 
 * Provides in-memory caching with TTL support for frequently accessed data.
 * Uses a simple Map-based cache that works without Redis, but can be easily
 * extended to use Redis when needed.
 * 
 * Cache Strategy:
 * - Master data (countries, ports, currencies, incoterms): 1 hour TTL
 * - Exchange rates: 15 minutes TTL
 * - Dashboard stats: 2 minutes TTL
 * - Dropdown options: 30 minutes TTL
 * - Search results: 5 minutes TTL
 */

import { logger } from '../utils/logger';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  size: number;
}

// TTL presets in seconds
export const CACHE_TTL = {
  MASTER_DATA: 60 * 60,      // 1 hour - countries, ports, currencies, incoterms
  EXCHANGE_RATES: 15 * 60,   // 15 minutes
  DASHBOARD: 2 * 60,         // 2 minutes
  DROPDOWNS: 30 * 60,        // 30 minutes
  SEARCH: 5 * 60,            // 5 minutes
  USER_SESSION: 60 * 60,     // 1 hour
  SHORT: 60,                 // 1 minute
  MEDIUM: 5 * 60,            // 5 minutes
  LONG: 30 * 60,             // 30 minutes
} as const;

// Cache key prefixes for organization
export const CACHE_KEYS = {
  COUNTRIES: 'master:countries',
  PORTS: 'master:ports',
  CURRENCIES: 'master:currencies',
  INCOTERMS: 'master:incoterms',
  PRODUCT_CATEGORIES: 'master:product-categories',
  DROPDOWNS: 'master:dropdowns',
  EXCHANGE_RATES: 'exchange:rates',
  EXCHANGE_RATES_CURRENT: 'exchange:current',
  DASHBOARD_MAIN: 'dashboard:main',
  DASHBOARD_SALES: 'dashboard:sales',
  DASHBOARD_FINANCE: 'dashboard:finance',
  BUYERS_LIST: 'buyers:list',
  PRODUCTS_LIST: 'products:list',
  SUPPLIERS_LIST: 'suppliers:list',
  SEARCH: 'search',
} as const;

class CacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    size: 0,
  };
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Run cleanup every minute to remove expired entries
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
    logger.info('Cache service initialized');
  }

  /**
   * Get a value from cache
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.size = this.cache.size;
      return null;
    }

    this.stats.hits++;
    return entry.data as T;
  }

  /**
   * Set a value in cache with TTL
   */
  set<T>(key: string, data: T, ttlSeconds: number = CACHE_TTL.MEDIUM): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      expiresAt: now + (ttlSeconds * 1000),
      createdAt: now,
    });
    this.stats.sets++;
    this.stats.size = this.cache.size;
  }

  /**
   * Delete a specific key from cache
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.deletes++;
      this.stats.size = this.cache.size;
    }
    return deleted;
  }

  /**
   * Delete all keys matching a pattern (prefix)
   */
  deletePattern(pattern: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(pattern)) {
        this.cache.delete(key);
        count++;
      }
    }
    this.stats.deletes += count;
    this.stats.size = this.cache.size;
    return count;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.deletes += size;
    this.stats.size = 0;
    logger.info('Cache cleared', { entriesCleared: size });
  }

  /**
   * Get or set pattern - fetch from cache or execute function and cache result
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlSeconds: number = CACHE_TTL.MEDIUM
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const data = await fetchFn();
    this.set(key, data, ttlSeconds);
    return data;
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & { hitRate: string } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) + '%' : '0%';
    return { ...this.stats, hitRate };
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let expired = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        expired++;
      }
    }

    if (expired > 0) {
      this.stats.size = this.cache.size;
      logger.debug('Cache cleanup', { expiredEntries: expired, remaining: this.cache.size });
    }
  }

  /**
   * Invalidate master data cache (call after updates)
   */
  invalidateMasterData(): void {
    this.deletePattern('master:');
    logger.debug('Master data cache invalidated');
  }

  /**
   * Invalidate exchange rates cache
   */
  invalidateExchangeRates(): void {
    this.deletePattern('exchange:');
    logger.debug('Exchange rates cache invalidated');
  }

  /**
   * Invalidate dashboard cache
   */
  invalidateDashboard(): void {
    this.deletePattern('dashboard:');
    logger.debug('Dashboard cache invalidated');
  }

  /**
   * Invalidate all entity list caches
   */
  invalidateLists(): void {
    this.deletePattern('buyers:');
    this.deletePattern('products:');
    this.deletePattern('suppliers:');
    logger.debug('List caches invalidated');
  }

  /**
   * Shutdown cleanup
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    logger.info('Cache service shutdown');
  }
}

// Export singleton instance
export const cache = new CacheService();

// Export for testing
export { CacheService };
