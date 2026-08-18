import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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
import { settingsRouter } from './routes/settings';
import { exchangeRateRouter } from './routes/exchangeRates';
import { expenseRouter } from './routes/expenses';
import { taskRouter } from './routes/tasks';
import { auditRouter } from './routes/audit';
import { auditLog } from './middleware/auditLog';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

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
//
// Audit logging is applied to everything under /api except auth. It records
// writes only, after the response has been sent, so it cannot affect the
// outcome of a request. Auth is excluded because login bodies carry passwords
// and a failed login is not a change to anything.
app.use('/api/auth', authRouter);

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
app.use('/api/settings', settingsRouter);
app.use('/api/exchange-rates', exchangeRateRouter);
app.use('/api/expenses', expenseRouter);
app.use('/api/tasks', taskRouter);
app.use('/api/audit', auditRouter);

// Error handling
// 404 for anything that didn't match a route above, then the error handler.
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
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
