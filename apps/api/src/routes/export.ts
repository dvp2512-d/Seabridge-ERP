/**
 * Data Export Routes
 * 
 * Provides CSV export functionality for various modules.
 */
import { Router } from 'express';
import { authenticate, can } from '../middleware/auth';
import {
  exportInvoices,
  exportOrders,
  exportBuyers,
  exportExpenses,
  exportReceivables,
  exportQuotations,
  exportAuditLog,
} from '../services/exportService';

const router: Router = Router();

router.use(authenticate);

/**
 * Helper to send CSV response
 */
function sendCSV(res: any, csv: string, filename: string) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

/**
 * Parse date range from query params
 */
function parseDateRange(from?: string, to?: string) {
  return {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  };
}

// Export invoices
router.get('/invoices', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const { status, buyerId, from, to } = req.query;
    
    const result = await exportInvoices({
      status: status as string,
      buyerId: buyerId as string,
      dateRange: parseDateRange(from as string, to as string),
    });

    const filename = `invoices_${new Date().toISOString().split('T')[0]}.csv`;
    sendCSV(res, result.csv, filename);
  } catch (error) {
    next(error);
  }
});

// Export orders
router.get('/orders', can('OPERATIONS_VIEW'), async (req, res, next) => {
  try {
    const { status, buyerId, from, to } = req.query;
    
    const result = await exportOrders({
      status: status as string,
      buyerId: buyerId as string,
      dateRange: parseDateRange(from as string, to as string),
    });

    const filename = `orders_${new Date().toISOString().split('T')[0]}.csv`;
    sendCSV(res, result.csv, filename);
  } catch (error) {
    next(error);
  }
});

// Export buyers
router.get('/buyers', can('BUYER_VIEW'), async (req, res, next) => {
  try {
    const { status } = req.query;
    
    const result = await exportBuyers({
      status: status as string,
    });

    const filename = `buyers_${new Date().toISOString().split('T')[0]}.csv`;
    sendCSV(res, result.csv, filename);
  } catch (error) {
    next(error);
  }
});

// Export expenses
router.get('/expenses', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const { status, category, from, to } = req.query;
    
    const result = await exportExpenses({
      status: status as string,
      category: category as string,
      dateRange: parseDateRange(from as string, to as string),
    });

    const filename = `expenses_${new Date().toISOString().split('T')[0]}.csv`;
    sendCSV(res, result.csv, filename);
  } catch (error) {
    next(error);
  }
});

// Export receivables report
router.get('/receivables', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const result = await exportReceivables();

    const filename = `receivables_${new Date().toISOString().split('T')[0]}.csv`;
    sendCSV(res, result.csv, filename);
  } catch (error) {
    next(error);
  }
});

// Export quotations
router.get('/quotations', can('SALES_VIEW'), async (req, res, next) => {
  try {
    const { status, buyerId, from, to } = req.query;
    
    const result = await exportQuotations({
      status: status as string,
      buyerId: buyerId as string,
      dateRange: parseDateRange(from as string, to as string),
    });

    const filename = `quotations_${new Date().toISOString().split('T')[0]}.csv`;
    sendCSV(res, result.csv, filename);
  } catch (error) {
    next(error);
  }
});

// Export audit log (admin only)
router.get('/audit', can('USER_VIEW'), async (req, res, next) => {
  try {
    const { entityType, action, userId, from, to } = req.query;
    
    const result = await exportAuditLog({
      entityType: entityType as string,
      action: action as string,
      userId: userId as string,
      dateRange: parseDateRange(from as string, to as string),
    });

    const filename = `audit_log_${new Date().toISOString().split('T')[0]}.csv`;
    sendCSV(res, result.csv, filename);
  } catch (error) {
    next(error);
  }
});

export { router as exportRouter };
