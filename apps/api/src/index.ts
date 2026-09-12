import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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
import { auditLog } from './middleware/auditLog';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Rate limiting - protect against brute force and API abuse
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per window for auth endpoints
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 requests per window for general API
  message: { success: false, message: 'Too many requests. Please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

// Error handling
// 404 for anything that didn't match a route above, then the error handler.
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    // Validate critical security configuration
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      console.error('❌ FATAL: JWT_SECRET must be set and at least 32 characters');
      process.exit(1);
    }

    await prisma.$connect();
    console.log('✅ Database connected');
    
    app.listen(PORT, () => {
      console.log(`🚀 SeaBridge API running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

export default app;
