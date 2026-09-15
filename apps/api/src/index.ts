import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { prisma } from '@seabridge/database';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth';
import { userRouter } from './routes/users';
import { buyerRouter } from './routes/buyers';
import { productRouter } from './routes/products';
import { supplierRouter } from './routes/suppliers';
import { chaRouter } from './routes/cha';
import { transporterRouter } from './routes/transporters';
import { inquiryRouter } from './routes/inquiries';
import { quotationRouter } from './routes/quotations';
import { orderRouter } from './routes/orders';
import { invoiceRouter } from './routes/invoices';
import { dashboardRouter } from './routes/dashboard';
import { masterDataRouter } from './routes/masterData';
import { automationRouter } from './routes/automation';
import { expenseRouter } from './routes/expenses';
import { incomeRouter } from './routes/income';
import { taskRouter } from './routes/tasks';
import { exchangeRateRouter } from './routes/exchangeRates';
import { settingsRouter } from './routes/settings';
import { lifecycleRouter } from './routes/lifecycle';
import { auditRouter } from './routes/audit';
import { recordDeletionRouter } from './routes/recordDeletion';
import { attachmentRouter } from './routes/attachments';
import { emailRouter } from './routes/email';
import { exportRouter } from './routes/export';
import { searchRouter } from './routes/search';
import { timelineRouter } from './routes/timeline';
import { bulkRouter } from './routes/bulk';
import { auditLog } from './middleware/auditLog';
import { logger, requestIdMiddleware } from './utils/logger';
import { cleanupExpiredTokens } from './services/refreshTokenService';
import { getRedisClient, RedisStore, distributedLock } from './services/redisService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

/**
 * Create rate limiter with Redis store for distributed deployments.
 * Falls back to in-memory store if Redis is not available.
 */
async function createRateLimiters() {
  const redisClient = await getRedisClient();
  
  const storeOptions = redisClient ? {
    store: new RedisStore({
      sendCommand: (command: string, ...args: string[]) => 
        redisClient.call(command, ...args) as Promise<number>,
    }),
  } : {};

  // Auth endpoints: strict rate limiting to prevent brute force
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per window
    message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Use IP + email for auth endpoints to prevent distributed attacks
      const email = req.body?.email || '';
      return `${req.ip}-${email}`;
    },
    ...storeOptions,
  });

  // General API: more permissive but still protective
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // 500 requests per window
    message: { success: false, message: 'Too many requests. Please try again shortly.' },
    standardHeaders: true,
    legacyHeaders: false,
    ...storeOptions,
  });

  return { authLimiter, apiLimiter, isDistributed: !!redisClient };
}

// Middleware
/**
 * Trust the first proxy (nginx or Docker network).
 * 
 * When behind a reverse proxy, Express needs to trust the X-Forwarded-For header
 * to get the real client IP for:
 *   - Rate limiting (to limit by actual client, not proxy)
 *   - Audit logging (to record real IP in audit entries)
 *   - Security logging (to identify attack sources)
 * 
 * Without this, all requests appear to come from the proxy's IP (typically 172.x.x.x),
 * which breaks per-IP rate limiting and makes audit trails useless.
 * 
 * Setting to 1 trusts exactly one proxy hop (the nginx container in our docker-compose).
 * For multi-proxy setups (e.g., CloudFlare + nginx), increase this number.
 */
app.set('trust proxy', 1);

app.use(helmet());
app.use(compression()); // Enable gzip compression for all responses
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request ID tracking - adds unique ID to each request for tracing
app.use(requestIdMiddleware);

// Health check - verifies the API is up and the database is reachable.
// Returns 503 when the DB ping fails so orchestrators treat it as not-ready.
app.get('/health', async (req, res) => {
  const requestId = (req as any).requestId;
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'ok', timestamp: new Date().toISOString(), requestId });
  } catch (error) {
    logger.error('Health check DB ping failed', { error: (error as Error).message, requestId });
    res.status(503).json({ status: 'error', database: 'unavailable', timestamp: new Date().toISOString(), requestId });
  }
});

// Start server
const startServer = async () => {
  try {
    // Validate critical security configuration
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      logger.error('FATAL: JWT_SECRET must be set and at least 32 characters');
      process.exit(1);
    }

    await prisma.$connect();
    logger.info('Database connected');

    // Initialize rate limiters (with Redis if available)
    const { authLimiter, apiLimiter, isDistributed } = await createRateLimiters();
    logger.info('Rate limiting initialized', { distributed: isDistributed });

    // API Routes
    // Auth routes have stricter rate limiting to prevent brute force attacks
    app.use('/api/auth', authLimiter, authRouter);

    // All other API routes use general rate limiting
    app.use('/api', apiLimiter);

    // Record every successful create/update/delete. Mounted after /api/auth on
    // purpose: login bodies carry passwords, and a failed login changes nothing.
    // The middleware reads req.user inside the response 'finish' handler, so the
    // per-router authenticate call has already run by the time it needs the actor.
    app.use('/api', auditLog);

    app.use('/api/users', userRouter);
    app.use('/api/buyers', buyerRouter);
    app.use('/api/products', productRouter);
    app.use('/api/suppliers', supplierRouter);
    app.use('/api/cha', chaRouter);
    app.use('/api/transporters', transporterRouter);
    app.use('/api/inquiries', inquiryRouter);
    app.use('/api/quotations', quotationRouter);
    app.use('/api/orders', orderRouter);
    app.use('/api/invoices', invoiceRouter);
    app.use('/api/dashboard', dashboardRouter);
    app.use('/api/master', masterDataRouter);
    app.use('/api/automation', automationRouter);
    app.use('/api/expenses', expenseRouter);
    app.use('/api/income', incomeRouter);
    app.use('/api/tasks', taskRouter);
    app.use('/api/exchange-rates', exchangeRateRouter);
    app.use('/api/settings', settingsRouter);
    app.use('/api/lifecycle', lifecycleRouter);
    app.use('/api/audit', auditRouter);
    app.use('/api/records', recordDeletionRouter);
    app.use('/api/attachments', attachmentRouter);
    app.use('/api/email', emailRouter);
    app.use('/api/export', exportRouter);
    app.use('/api/search', searchRouter);
    app.use('/api/timeline', timelineRouter);
    app.use('/api/bulk', bulkRouter);

    // Error handling
    // 404 for anything that didn't match a route above, then the error handler.
    app.use(notFoundHandler);
    app.use(errorHandler);

    // Schedule token cleanup - runs daily at startup and every 24 hours
    const runTokenCleanup = async () => {
      // Use distributed lock to ensure only one instance runs cleanup
      await distributedLock.withLock('job:token-cleanup', async () => {
        try {
          const count = await cleanupExpiredTokens();
          if (count > 0) {
            logger.info('Token cleanup completed', { deletedCount: count });
          }
        } catch (error) {
          logger.error('Token cleanup failed', { error: (error as Error).message });
        }
      }, 5 * 60 * 1000); // 5 minute lock TTL
    };

    // Run cleanup on startup (after a short delay to let the server start)
    setTimeout(runTokenCleanup, 10000);
    
    // Schedule cleanup to run every 24 hours
    setInterval(runTokenCleanup, 24 * 60 * 60 * 1000);
    logger.info('Token cleanup scheduled (daily, distributed lock enabled)');

    // Schedule webhook retry - runs every 15 minutes to retry failed webhooks with exponential backoff
    const { retryFailedWebhooks } = await import('./services/eventService');
    const runWebhookRetry = async () => {
      // Use distributed lock to prevent duplicate webhook deliveries
      await distributedLock.withLock('job:webhook-retry', async () => {
        try {
          const result = await retryFailedWebhooks();
          if (result.retried > 0) {
            logger.info('Webhook retry completed', { retried: result.retried, succeeded: result.succeeded });
          }
        } catch (error) {
          logger.error('Webhook retry failed', { error: (error as Error).message });
        }
      }, 10 * 60 * 1000); // 10 minute lock TTL
    };
    
    // Run webhook retry after a short delay and every 15 minutes
    setTimeout(runWebhookRetry, 30000); // 30 sec delay at startup
    setInterval(runWebhookRetry, 15 * 60 * 1000); // Every 15 minutes
    logger.info('Webhook retry scheduler initialized (every 15 minutes, distributed lock enabled)');

    // Schedule email queue processor - runs every 5 minutes to send pending emails
    const { processEmailQueue } = await import('./services/emailService');
    const runEmailQueue = async () => {
      // Use distributed lock to prevent duplicate email sends
      await distributedLock.withLock('job:email-queue', async () => {
        try {
          const result = await processEmailQueue(10);
          if (result.processed > 0) {
            logger.info('Email queue processed', { processed: result.processed, sent: result.sent, failed: result.failed });
          }
        } catch (error) {
          logger.error('Email queue processing failed', { error: (error as Error).message });
        }
      }, 3 * 60 * 1000); // 3 minute lock TTL
    };
    
    // Run email queue processing after a short delay and every 5 minutes
    setTimeout(runEmailQueue, 60000); // 60 sec delay at startup
    setInterval(runEmailQueue, 5 * 60 * 1000); // Every 5 minutes
    logger.info('Email queue processor initialized (every 5 minutes, distributed lock enabled)');
    
    const server = app.listen(PORT, () => {
      logger.info('SeaBridge API started', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
      });
    });

    /**
     * Graceful shutdown handler.
     * 
     * When the process receives SIGTERM (container stop) or SIGINT (Ctrl+C):
     * 1. Stop accepting new connections
     * 2. Wait for in-flight requests to complete (with timeout)
     * 3. Close database connection pool
     * 4. Close Redis connection
     * 5. Exit cleanly
     * 
     * This prevents dropped requests during deployments and ensures database
     * connections are properly released.
     */
    const gracefulShutdown = async (signal: string) => {
      logger.info('Shutdown signal received, closing server gracefully', { signal });
      
      // Stop accepting new connections
      server.close(async (err) => {
        if (err) {
          logger.error('Error during server close', { error: err.message });
        }
        
        logger.info('Server closed, cleaning up resources');
        
        try {
          // Close database connection pool
          await prisma.$disconnect();
          logger.info('Database disconnected');
          
          // Close Redis connection if available
          const redisClient = await getRedisClient();
          if (redisClient) {
            await redisClient.quit();
            logger.info('Redis disconnected');
          }
        } catch (cleanupError) {
          logger.error('Error during cleanup', { error: (cleanupError as Error).message });
        }
        
        logger.info('Shutdown complete');
        process.exit(err ? 1 : 0);
      });

      // Force exit after timeout if connections don't drain
      setTimeout(() => {
        logger.warn('Forcefully shutting down after timeout');
        process.exit(1);
      }, 30000); // 30 second timeout
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server', { error: (error as Error).message });
    process.exit(1);
  }
};

startServer();

export default app;
