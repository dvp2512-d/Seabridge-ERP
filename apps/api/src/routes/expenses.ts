/**
 * Expenses.
 *
 * Costs incurred running the business - freight, CHA charges, packaging, travel.
 * Recorded in whatever currency they were paid in, so the summary converts into
 * the base currency rather than adding the raw numbers.
 *
 * Approval is a deliberate two-step: whoever records an expense is not
 * necessarily whoever approves it, and a paid expense cannot be edited.
 */
import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';
import { getBaseCurrency } from '../services/exchangeRateService';
import { emitEvent } from '../services/eventService';
import {
  EXPENSE_SOURCE_TYPES,
  recalculateExpensePayment,
  syncProcurementExpense,
  syncShipmentExpenses,
} from '../services/expenseSyncService';

const router: Router = Router();

router.use(authenticate);

/**
 * Expense categories.
 *
 * The first four are also produced automatically from operational records - a
 * supplier purchase order, and the freight, CHA and transport costs on a shipment -
 * by services/expenseSyncService.ts. The rest are entered by hand.
 */
const CATEGORIES = [
  'SUPPLIER_PAYMENT',
  'FREIGHT',
  'CHA',
  'TRANSPORT',
  'PACKAGING',
  'INSURANCE',
  'INSPECTION',
  'COMMISSION',
  'CERTIFICATION',
  'TRAVEL',
  'OFFICE',
  'BANK_CHARGES',
  'FOREX_LOSS',
  'OTHER',
] as const;

const STATUSES = ['PENDING', 'APPROVED', 'PAID', 'REJECTED'] as const;

// ---------------------------------------------------------------- list

/**
 * Database schema state for expenses table.
 * The schema has evolved through migrations:
 * - Initial: has 'currency' column, no payment tracking
 * - After 20260910120000: 'currency' dropped
 * - After 20260911120000: payment tracking columns added (paid_amount, balance_amount, etc.)
 */
interface SchemaState {
  hasPaymentColumns: boolean;  // paid_amount, balance_amount, source_type, etc.
  hasCurrencyColumn: boolean;  // legacy 'currency' column
  hasExpensePaymentsTable: boolean; // expense_payments table exists
}

let schemaState: SchemaState | null = null;

async function detectSchemaState(): Promise<SchemaState> {
  if (schemaState !== null) return schemaState;
  
  // Check which columns exist using information_schema
  try {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'expenses' 
      AND column_name IN ('paid_amount', 'currency', 'source_type')
    `;
    
    const columnNames = columns.map(c => c.column_name);
    
    // Also check if expense_payments table exists
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public' AND tablename = 'expense_payments'
    `;
    
    schemaState = {
      hasPaymentColumns: columnNames.includes('paid_amount'),
      hasCurrencyColumn: columnNames.includes('currency'),
      hasExpensePaymentsTable: tables.length > 0,
    };
  } catch (err) {
    // Fallback: assume newest schema
    schemaState = { hasPaymentColumns: true, hasCurrencyColumn: false, hasExpensePaymentsTable: true };
  }
  
  return schemaState;
}

/**
 * Get the SELECT columns for raw SQL based on schema state
 */
function getSelectColumns(state: SchemaState): string {
  const baseColumns = `
    "id", "expense_number" as "expenseNumber", "category", "description",
    "amount", "expense_date" as "expenseDate", "vendor_name" as "vendorName",
    "invoice_ref" as "invoiceRef", "status", "notes",
    "created_at" as "createdAt", "updated_at" as "updatedAt"
  `;
  
  if (state.hasPaymentColumns) {
    return baseColumns + `,
      "paid_amount" as "paidAmount", "balance_amount" as "balanceAmount",
      "source_type" as "sourceType", "source_id" as "sourceId", "is_generated" as "isGenerated"
    `;
  }
  
  return baseColumns;
}

/**
 * Add default values for missing columns in legacy schema
 */
function addDefaultValues(expense: any, state: SchemaState): any {
  if (state.hasPaymentColumns) return expense;
  
  return {
    ...expense,
    paidAmount: expense.status === 'PAID' ? expense.amount : 0,
    balanceAmount: expense.status === 'PAID' ? 0 : expense.amount,
    isGenerated: false,
    sourceType: 'MANUAL',
    sourceId: null,
  };
}

router.get('/', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const {
      category,
      status,
      search,
      from,
      to,
      page = 1,
      limit = 50,
    } = req.query;

    const state = await detectSchemaState();
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    // Always use raw SQL to avoid Prisma schema mismatch issues
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (category) {
      conditions.push(`"category" = $${paramIndex++}`);
      values.push(String(category));
    }
    if (status) {
      conditions.push(`"status" = $${paramIndex++}`);
      values.push(String(status));
    }
    if (from) {
      conditions.push(`"expense_date" >= $${paramIndex++}`);
      values.push(new Date(String(from)));
    }
    if (to) {
      conditions.push(`"expense_date" <= $${paramIndex++}`);
      values.push(new Date(String(to)));
    }
    if (search) {
      const searchPattern = `%${String(search)}%`;
      conditions.push(`("description" ILIKE $${paramIndex} OR "vendor_name" ILIKE $${paramIndex} OR "expense_number" ILIKE $${paramIndex} OR "invoice_ref" ILIKE $${paramIndex})`);
      values.push(searchPattern);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const selectColumns = getSelectColumns(state);

    // Build and execute queries
    const expensesQuery = `
      SELECT ${selectColumns}
      FROM "expenses"
      ${whereClause}
      ORDER BY "expense_date" DESC
      LIMIT ${limitNum} OFFSET ${skip}
    `;
    
    const countQuery = `SELECT COUNT(*)::int as count FROM "expenses" ${whereClause}`;
    
    const statusSumColumn = state.hasPaymentColumns 
      ? `COALESCE(SUM("amount"), 0) as amount, COALESCE(SUM("paid_amount"), 0) as paid, COALESCE(SUM("balance_amount"), 0) as balance`
      : `COALESCE(SUM("amount"), 0) as amount`;
    
    const statusQuery = `
      SELECT "status", COUNT(*)::int as count, ${statusSumColumn}
      FROM "expenses"
      ${whereClause}
      GROUP BY "status"
    `;
    
    const categoryQuery = `
      SELECT "category", COUNT(*)::int as count, COALESCE(SUM("amount"), 0) as amount
      FROM "expenses"
      ${whereClause}
      GROUP BY "category"
    `;

    const [expensesResult, countResult, statusResult, categoryResult] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(expensesQuery, ...values),
      prisma.$queryRawUnsafe<{ count: number }[]>(countQuery, ...values),
      prisma.$queryRawUnsafe<any[]>(statusQuery, ...values),
      prisma.$queryRawUnsafe<any[]>(categoryQuery, ...values),
    ]);

    const expenses = expensesResult.map(e => addDefaultValues(e, state));
    const total = countResult[0]?.count ?? 0;

    const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

    const countByStatus: Record<string, number> = {};
    let totalSpend = 0;
    let pendingApproval = 0;
    let outstanding = 0;
    let paid = 0;

    for (const row of statusResult) {
      countByStatus[row.status] = row.count;
      const amount = Number(row.amount ?? 0);
      
      if (row.status !== 'REJECTED') {
        totalSpend += amount;
        if (state.hasPaymentColumns) {
          outstanding += Number(row.balance ?? 0);
          paid += Number(row.paid ?? 0);
        } else {
          // Legacy mode: estimate based on status
          if (row.status === 'PAID') {
            paid += amount;
          } else {
            outstanding += amount;
          }
        }
      }
      if (row.status === 'PENDING') pendingApproval += amount;
    }

    const byCategory = categoryResult.map(r => ({
      category: r.category,
      value: round2(Number(r.amount ?? 0)),
    })).sort((a, b) => b.value - a.value);

    res.json({
      success: true,
      data: expenses,
      pagination: { page: Number(page), limit: Number(limit), total },
      summary: {
        baseCurrency: await getBaseCurrency(),
        countByStatus,
        totalSpend: round2(totalSpend),
        pendingApproval: round2(pendingApproval),
        outstanding: round2(outstanding),
        paid: round2(paid),
        byCategory,
      },
      _migrationNeeded: !state.hasPaymentColumns,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const state = await detectSchemaState();
    const selectColumns = getSelectColumns(state);
    
    const results = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ${selectColumns} FROM "expenses" WHERE "id" = $1 LIMIT 1`,
      req.params.id
    );
    
    if (results.length === 0) throw new NotFoundError('Expense');
    
    let expense = addDefaultValues(results[0], state);
    
    // Add payments if the table exists
    if (state.hasPaymentColumns) {
      try {
        const payments = await prisma.$queryRaw<any[]>`
          SELECT "id", "expense_id" as "expenseId", "amount", "payment_date" as "paymentDate",
            "method", "reference", "notes", "created_at" as "createdAt"
          FROM "expense_payments"
          WHERE "expense_id" = ${req.params.id}
          ORDER BY "payment_date" DESC
        `;
        expense = { ...expense, payments };
      } catch {
        expense = { ...expense, payments: [] };
      }
    } else {
      expense = { ...expense, payments: [] };
    }
    
    res.json({ success: true, data: expense });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- create

const createSchema = z.object({
  category: z.enum(CATEGORIES),
  description: z.string().min(1, 'Description is required'),
  // INR. Expenses are domestic costs recorded in rupees, like every amount here.
  amount: z.number().positive('Amount must be greater than zero'),
  expenseDate: z.string().min(1),
  vendorName: z.string().optional(),
  invoiceRef: z.string().optional(),
  notes: z.string().optional(),
});

router.post('/', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const validation = createSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const data = validation.data;
    const state = await detectSchemaState();

    const expenseNumber = await generateCode('EXPENSE', 'EXP');
    const id = `c${Date.now()}${Math.random().toString(36).slice(2, 11)}`;
    const now = new Date();
    const expenseDate = new Date(data.expenseDate);

    // Always use raw SQL to avoid schema mismatch
    if (state.hasPaymentColumns) {
      await prisma.$executeRaw`
        INSERT INTO "expenses" (
          "id", "expense_number", "category", "description", "amount",
          "expense_date", "vendor_name", "invoice_ref", "status", "notes",
          "paid_amount", "balance_amount", "source_type", "is_generated",
          "created_at", "updated_at"
        ) VALUES (
          ${id}, ${expenseNumber}, ${data.category}, ${data.description}, ${data.amount},
          ${expenseDate}, ${data.vendorName || null}, ${data.invoiceRef || null}, 
          'PENDING', ${data.notes || null}, 0, ${data.amount}, 'MANUAL', false,
          ${now}, ${now}
        )
      `;
    } else if (state.hasCurrencyColumn) {
      // Legacy schema with currency column
      await prisma.$executeRaw`
        INSERT INTO "expenses" (
          "id", "expense_number", "category", "description", "amount", "currency",
          "expense_date", "vendor_name", "invoice_ref", "status", "notes",
          "created_at", "updated_at"
        ) VALUES (
          ${id}, ${expenseNumber}, ${data.category}, ${data.description}, ${data.amount}, 'INR',
          ${expenseDate}, ${data.vendorName || null}, ${data.invoiceRef || null}, 
          'PENDING', ${data.notes || null}, ${now}, ${now}
        )
      `;
    } else {
      // Schema without currency and without payment columns
      await prisma.$executeRaw`
        INSERT INTO "expenses" (
          "id", "expense_number", "category", "description", "amount",
          "expense_date", "vendor_name", "invoice_ref", "status", "notes",
          "created_at", "updated_at"
        ) VALUES (
          ${id}, ${expenseNumber}, ${data.category}, ${data.description}, ${data.amount},
          ${expenseDate}, ${data.vendorName || null}, ${data.invoiceRef || null}, 
          'PENDING', ${data.notes || null}, ${now}, ${now}
        )
      `;
    }
    
    const expense = {
      id,
      expenseNumber,
      category: data.category,
      description: data.description,
      amount: data.amount,
      expenseDate,
      vendorName: data.vendorName || null,
      invoiceRef: data.invoiceRef || null,
      status: 'PENDING',
      notes: data.notes || null,
      paidAmount: 0,
      balanceAmount: data.amount,
      isGenerated: false,
      sourceType: 'MANUAL',
      sourceId: null,
      createdAt: now,
      updatedAt: now,
    };

    res.status(201).json({ success: true, data: expense });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- update

const updateSchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  description: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  expenseDate: z.string().optional(),
  vendorName: z.string().optional(),
  invoiceRef: z.string().optional(),
  notes: z.string().optional(),
});

router.put('/:id', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const validation = updateSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const state = await detectSchemaState();
    
    // Check if expense exists
    const existingResult = await prisma.$queryRaw<any[]>`
      SELECT "id", "expense_number" as "expenseNumber", "status", "amount"
      FROM "expenses" WHERE "id" = ${req.params.id} LIMIT 1
    `;
    
    if (existingResult.length === 0) throw new NotFoundError('Expense');
    const existing = existingResult[0];

    // Once money has gone out the record is evidence, not a draft.
    if (existing.status === 'PAID') {
      throw new AppError(
        'A paid expense cannot be edited. Record a correcting expense instead so the trail stays intact.',
        400
      );
    }

    const { expenseDate, ...rest } = validation.data;
    
    // Build update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (rest.category !== undefined) {
      updates.push(`"category" = $${paramIndex++}`);
      values.push(rest.category);
    }
    if (rest.description !== undefined) {
      updates.push(`"description" = $${paramIndex++}`);
      values.push(rest.description);
    }
    if (rest.amount !== undefined) {
      updates.push(`"amount" = $${paramIndex++}`);
      values.push(rest.amount);
      
      // Update balance if payment columns exist
      if (state.hasPaymentColumns) {
        updates.push(`"balance_amount" = $${paramIndex++}`);
        values.push(rest.amount); // Simplified: assume no payments yet
      }
    }
    if (expenseDate !== undefined) {
      updates.push(`"expense_date" = $${paramIndex++}`);
      values.push(new Date(expenseDate));
    }
    if (rest.vendorName !== undefined) {
      updates.push(`"vendor_name" = $${paramIndex++}`);
      values.push(rest.vendorName || null);
    }
    if (rest.invoiceRef !== undefined) {
      updates.push(`"invoice_ref" = $${paramIndex++}`);
      values.push(rest.invoiceRef || null);
    }
    if (rest.notes !== undefined) {
      updates.push(`"notes" = $${paramIndex++}`);
      values.push(rest.notes || null);
    }
    
    updates.push(`"updated_at" = $${paramIndex++}`);
    values.push(new Date());
    
    values.push(req.params.id);

    if (updates.length > 1) { // More than just updated_at
      await prisma.$executeRawUnsafe(
        `UPDATE "expenses" SET ${updates.join(', ')} WHERE "id" = $${paramIndex}`,
        ...values
      );
    }

    // Fetch updated record
    const selectColumns = getSelectColumns(state);
    const results = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ${selectColumns} FROM "expenses" WHERE "id" = $1 LIMIT 1`,
      req.params.id
    );
    
    const expense = results[0] ? addDefaultValues(results[0], state) : null;

    res.json({ success: true, data: expense });
  } catch (error) {
    next(error);
  }
});

/**
 * Move an expense through PENDING -> APPROVED -> PAID, or reject it.
 *
 * Transitions are restricted so an expense cannot jump straight to paid without
 * being approved, and a rejected one cannot quietly become paid.
 */
const statusSchema = z.object({ status: z.enum(STATUSES) });

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['PAID', 'REJECTED'],
  REJECTED: ['PENDING'],
  PAID: [],
};

// PATCH for consistency with income status update and quotation status update
router.patch('/:id/status', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const validation = statusSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const state = await detectSchemaState();
    
    // Check if expense exists
    const existingResult = await prisma.$queryRaw<any[]>`
      SELECT "id", "expense_number" as "expenseNumber", "status"
      FROM "expenses" WHERE "id" = ${req.params.id} LIMIT 1
    `;
    
    if (existingResult.length === 0) throw new NotFoundError('Expense');
    const existing = existingResult[0];

    const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(validation.data.status)) {
      throw new AppError(
        `An expense that is ${existing.status} cannot become ${validation.data.status}.${
          allowed.length ? ` Allowed: ${allowed.join(', ')}.` : ' It is final.'
        }`,
        400
      );
    }

    // Update status
    await prisma.$executeRaw`
      UPDATE "expenses" SET "status" = ${validation.data.status}, "updated_at" = ${new Date()}
      WHERE "id" = ${req.params.id}
    `;
    
    // Fetch updated record
    const selectColumns = getSelectColumns(state);
    const results = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ${selectColumns} FROM "expenses" WHERE "id" = $1 LIMIT 1`,
      req.params.id
    );
    
    const expense = results[0] ? addDefaultValues(results[0], state) : null;

    // Only approval is announced
    if (validation.data.status === 'APPROVED') {
      emitEvent('expense.approved', expense);
    }

    res.json({ success: true, data: expense });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', can('RECORD_DELETE'), async (req, res, next) => {
  try {
    // Check if expense exists
    const existsResult = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "expenses" WHERE "id" = ${req.params.id} LIMIT 1
    `;
    
    if (existsResult.length === 0) throw new NotFoundError('Expense');

    // Always use raw SQL to avoid schema mismatch
    await prisma.$executeRaw`DELETE FROM "expenses" WHERE "id" = ${req.params.id}`;
    
    res.json({ success: true, data: { id: req.params.id } });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- payments

/**
 * Payments made against an expense.
 *
 * The outgoing counterpart of invoice payments. Suppliers are routinely paid in
 * parts - an advance against the purchase order, the balance on delivery - so a
 * single paid flag could not represent what is actually still owed.
 *
 * The expense's paidAmount, balanceAmount and status are recalculated from the
 * payment rows rather than set here, so the three can never disagree with the
 * history. See recalculateExpensePayment.
 */
const paymentSchema = z.object({
  amount: z.number().positive('A payment must be greater than zero'),
  paymentDate: z.string(),
  method: z.enum(['BANK_TRANSFER', 'CHEQUE', 'CASH', 'UPI', 'CARD']).optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

router.get('/:id/payments', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const state = await detectSchemaState();
    
    if (!state.hasPaymentColumns || !state.hasExpensePaymentsTable) {
      return res.status(503).json({
        success: false,
        message: 'Payment tracking requires a database migration. Run deploy.cmd or npm run db:deploy to enable this feature.',
      });
    }
    
    // Use raw SQL to be safe
    const expenseResult = await prisma.$queryRaw<any[]>`
      SELECT "id", "amount", "paid_amount" as "paidAmount", "balance_amount" as "balanceAmount"
      FROM "expenses" WHERE "id" = ${req.params.id} LIMIT 1
    `;
    
    if (expenseResult.length === 0) throw new NotFoundError('Expense');
    const expense = expenseResult[0];

    const payments = await prisma.$queryRaw<any[]>`
      SELECT "id", "expense_id" as "expenseId", "amount", "payment_date" as "paymentDate",
        "method", "reference", "notes", "created_at" as "createdAt"
      FROM "expense_payments"
      WHERE "expense_id" = ${req.params.id}
      ORDER BY "payment_date" DESC
    `;

    res.json({ success: true, data: { expense, payments } });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/payments', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const state = await detectSchemaState();
    
    if (!state.hasPaymentColumns || !state.hasExpensePaymentsTable) {
      return res.status(503).json({
        success: false,
        message: 'Payment tracking requires a database migration. Run deploy.cmd or npm run db:deploy to enable this feature.',
      });
    }
    
    const validation = paymentSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const data = validation.data;

    /**
     * CRITICAL: Use a transaction with FOR UPDATE lock to prevent race conditions
     * where concurrent payments could both pass overpayment checks and corrupt balances.
     */
    const result = await prisma.$transaction(async (tx) => {
      // Lock the expense row to prevent concurrent payment race conditions
      const expenseResult = await tx.$queryRaw<any[]>`
        SELECT "id", "expense_number" as "expenseNumber", "amount", "paid_amount" as "paidAmount", "status"
        FROM "expenses" WHERE "id" = ${req.params.id}
        FOR UPDATE
      `;
      
      if (expenseResult.length === 0) throw new NotFoundError('Expense');
      const expense = expenseResult[0];

      if (expense.status === 'REJECTED') {
        throw new AppError(
          `${expense.expenseNumber} was rejected. Reopen it before recording a payment.`,
          400
        );
      }

      const amount = Number(expense.amount);
      const alreadyPaid = Number(expense.paidAmount);
      const outstanding = Math.round((amount - alreadyPaid + Number.EPSILON) * 100) / 100;

      if (data.amount > outstanding + 0.005) {
        throw new AppError(
          `That is more than is outstanding. ${expense.expenseNumber} has ` +
            `INR ${outstanding.toFixed(2)} left to pay of INR ${amount.toFixed(2)}.`,
          400
        );
      }

      // Use raw SQL to avoid Prisma schema mismatch
      const paymentId = crypto.randomUUID();
      const paymentDate = new Date(data.paymentDate);
      const method = data.method ?? 'BANK_TRANSFER';
      const now = new Date();

      // Create payment using raw SQL
      await tx.$executeRaw`
        INSERT INTO "expense_payments" ("id", "expense_id", "amount", "payment_date", "method", "reference", "notes", "created_at", "updated_at")
        VALUES (${paymentId}, ${expense.id}, ${data.amount}, ${paymentDate}, ${method}, ${data.reference || null}, ${data.notes || null}, ${now}, ${now})
      `;

      // Recalculate expense totals using raw SQL
      const newPaidAmount = alreadyPaid + data.amount;
      const newBalanceAmount = Math.round((amount - newPaidAmount + Number.EPSILON) * 100) / 100;
      let newStatus = expense.status;
      
      if (newBalanceAmount <= 0) {
        newStatus = 'PAID';
      } else if (newPaidAmount > 0) {
        newStatus = 'APPROVED';
      }

      await tx.$executeRaw`
        UPDATE "expenses" 
        SET "paid_amount" = ${newPaidAmount}, "balance_amount" = ${newBalanceAmount}, "status" = ${newStatus}, "updated_at" = ${now}
        WHERE "id" = ${expense.id}
      `;

      // Fetch the created payment
      const paymentResult = await tx.$queryRaw<any[]>`
        SELECT "id", "expense_id" as "expenseId", "amount", "payment_date" as "paymentDate", "method", "reference", "notes", "created_at" as "createdAt"
        FROM "expense_payments" WHERE "id" = ${paymentId}
      `;
      const payment = paymentResult[0];

      return { payment, expenseId: expense.id };
    });

    // Fetch updated expense outside transaction for response
    const selectColumns = getSelectColumns(state);
    const updatedResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ${selectColumns} FROM "expenses" WHERE "id" = $1`,
      result.expenseId
    );
    const updated = updatedResult[0] ? addDefaultValues(updatedResult[0], state) : null;

    if (updated?.status === 'PAID') emitEvent('expense.paid', updated);

    res.status(201).json({ success: true, data: { payment: result.payment, expense: updated } });
  } catch (error) {
    next(error);
  }
});

/**
 * Reverse a payment - a cheque bounced, or the entry was wrong.
 *
 * Deletes rather than negates, because an expense payment carries no downstream
 * record that a reversal row would need to match, and the audit log already holds
 * what was removed and by whom. The expense's totals and status are recalculated,
 * so a fully paid expense correctly returns to part paid.
 */
router.delete('/:id/payments/:paymentId', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const state = await detectSchemaState();
    
    if (!state.hasPaymentColumns || !state.hasExpensePaymentsTable) {
      return res.status(503).json({
        success: false,
        message: 'Payment tracking requires a database migration. Run deploy.cmd or npm run db:deploy to enable this feature.',
      });
    }
    
    // Use raw SQL to check payment
    const paymentResult = await prisma.$queryRaw<any[]>`
      SELECT "id", "expense_id" as "expenseId"
      FROM "expense_payments" WHERE "id" = ${req.params.paymentId} LIMIT 1
    `;
    
    if (paymentResult.length === 0) throw new NotFoundError('Payment');
    const payment = paymentResult[0];
    
    if (payment.expenseId !== req.params.id) {
      throw new NotFoundError('Payment not found for this expense');
    }

    // Get the payment amount before deleting
    const paymentAmountResult = await prisma.$queryRaw<any[]>`
      SELECT "amount" FROM "expense_payments" WHERE "id" = ${payment.id}
    `;
    const paymentAmount = Number(paymentAmountResult[0]?.amount ?? 0);

    // Delete the payment using raw SQL
    await prisma.$executeRaw`DELETE FROM "expense_payments" WHERE "id" = ${payment.id}`;

    // Get current expense data
    const expenseResult = await prisma.$queryRaw<any[]>`
      SELECT "amount", "paid_amount" as "paidAmount", "status"
      FROM "expenses" WHERE "id" = ${payment.expenseId}
    `;
    const expense = expenseResult[0];
    
    if (expense) {
      const amount = Number(expense.amount);
      const currentPaid = Number(expense.paidAmount);
      const newPaidAmount = Math.max(0, currentPaid - paymentAmount);
      const newBalanceAmount = Math.round((amount - newPaidAmount + Number.EPSILON) * 100) / 100;
      
      let newStatus = expense.status;
      if (newPaidAmount <= 0) {
        if (expense.status === 'PAID') newStatus = 'APPROVED';
      } else if (newBalanceAmount <= 0) {
        newStatus = 'PAID';
      } else {
        newStatus = 'APPROVED';
      }

      await prisma.$executeRaw`
        UPDATE "expenses" 
        SET "paid_amount" = ${newPaidAmount}, "balance_amount" = ${newBalanceAmount}, "status" = ${newStatus}, "updated_at" = ${new Date()}
        WHERE "id" = ${payment.expenseId}
      `;
    }

    // Fetch updated expense
    const selectColumns = getSelectColumns(state);
    const results = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ${selectColumns} FROM "expenses" WHERE "id" = $1 LIMIT 1`,
      payment.expenseId
    );
    
    const updated = results[0] ? addDefaultValues(results[0], state) : null;
    
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

/**
 * Generate expenses for procurements and shipments that already exist.
 *
 * Records created before the sync existed have no expense behind them, so the
 * payables figure would only be right for new work. This walks the existing rows
 * once and raises what is missing.
 *
 * Safe to run repeatedly: every expense is keyed on its source record by a unique
 * index, so a second run updates rather than duplicates. Reported per record so a
 * partial result is visible rather than silent.
 *
 * Restricted to FINANCE_MANAGE because it writes to the ledger, even though it
 * writes nothing that saving each source record would not have written anyway.
 */
router.post('/sync', can('FINANCE_MANAGE'), async (_req, res, next) => {
  try {
    // First verify the database has the required columns by doing a minimal query.
    // This gives a clear error message rather than failing mid-sync.
    try {
      await prisma.expense.findFirst({
        select: { sourceType: true, sourceId: true, isGenerated: true, paidAmount: true, balanceAmount: true },
        take: 1,
      });
    } catch (schemaError: unknown) {
      const msg = schemaError instanceof Error ? schemaError.message : String(schemaError);
      if (msg.includes('P2022') || msg.includes('column') || msg.includes('does not exist')) {
        return res.status(500).json({
          success: false,
          error: 'Database schema is out of date. Please run migrations: npm run db:deploy (or deploy.cmd to redeploy)',
          details: 'The expense sync feature requires columns that were added in recent migrations.',
        });
      }
      throw schemaError;
    }

    const [procurements, shipments] = await Promise.all([
      prisma.procurement.findMany({ select: { id: true } }),
      prisma.shipment.findMany({
        // Only shipments carrying at least one cost can produce an expense.
        where: {
          OR: [
            { freightCost: { not: null } },
            { chaCharges: { not: null } },
            { transportCharges: { not: null } },
          ],
        },
        select: { id: true },
      }),
    ]);

    const tally = { created: 0, updated: 0, deleted: 0, locked: 0, unchanged: 0 };
    const conflicts: string[] = [];

    const record = (result: { action: keyof typeof tally; conflict?: string }) => {
      tally[result.action] += 1;
      if (result.conflict) conflicts.push(result.conflict);
    };

    for (const procurement of procurements) {
      record(await syncProcurementExpense(procurement.id));
    }

    for (const shipment of shipments) {
      for (const result of await syncShipmentExpenses(shipment.id)) {
        record(result);
      }
    }

    res.json({
      success: true,
      data: {
        procurementsScanned: procurements.length,
        shipmentsScanned: shipments.length,
        ...tally,
        conflicts,
      },
    });
  } catch (error) {
    next(error);
  }
});

/** Category list for the UI, so the options cannot drift from the validation. */
router.get('/meta/options', can('FINANCE_VIEW'), async (_req, res) => {
  res.json({
    success: true,
    data: { categories: CATEGORIES, statuses: STATUSES },
  });
});

/**
 * Search vendors across Suppliers, CHAs, and Transporters for auto-complete.
 * Returns a unified list with the source type so the UI can display it.
 */
router.get('/meta/vendors', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const { search, category } = req.query;
    const searchFilter = search
      ? { name: { contains: String(search), mode: 'insensitive' as const } }
      : {};

    // Fetch based on category for smarter suggestions
    const results: { id: string; name: string; type: string; contactPerson?: string }[] = [];

    // For CHA category, prioritize CHA agents
    if (!category || category === 'CHA') {
      const chas = await prisma.cHA.findMany({
        where: { isActive: true, ...searchFilter },
        select: { id: true, name: true, contactPerson: true },
        take: 10,
      });
      results.push(...chas.map(c => ({ id: c.id, name: c.name, type: 'CHA', contactPerson: c.contactPerson || undefined })));
    }

    // For TRANSPORT category, prioritize Transporters
    if (!category || category === 'TRANSPORT' || category === 'FREIGHT') {
      const transporters = await prisma.transporter.findMany({
        where: { isActive: true, ...searchFilter },
        select: { id: true, name: true, contactPerson: true },
        take: 10,
      });
      results.push(...transporters.map(t => ({ id: t.id, name: t.name, type: 'TRANSPORTER', contactPerson: t.contactPerson || undefined })));
    }

    // For other categories or general search, include Suppliers
    if (!category || !['CHA', 'TRANSPORT'].includes(String(category))) {
      const suppliers = await prisma.supplier.findMany({
        where: { isActive: true, ...searchFilter },
        select: { id: true, name: true, contactPerson: true },
        take: 10,
      });
      results.push(...suppliers.map(s => ({ id: s.id, name: s.name, type: 'SUPPLIER', contactPerson: s.contactPerson || undefined })));
    }

    // Sort by name and limit
    results.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ success: true, data: results.slice(0, 20) });
  } catch (error) {
    next(error);
  }
});

/**
 * Get linkable records (shipments, orders) that can be associated with an expense.
 * Used to pre-fill expense details from existing business records.
 */
router.get('/meta/linkable-records', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const { category } = req.query;

    // For FREIGHT, CHA, TRANSPORT - fetch recent shipments with cost data
    const shipments = await prisma.shipment.findMany({
      where: {
        status: { notIn: ['DELIVERED'] },
      },
      select: {
        id: true,
        shipmentNumber: true,
        freightCost: true,
        status: true,
        cha: { select: { id: true, name: true } },
        transporter: { select: { id: true, name: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            buyer: { select: { companyName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Fetch recent orders for general expense linking
    const orders = await prisma.exportOrder.findMany({
      where: {
        status: { notIn: ['DELIVERED', 'CANCELLED'] },
      },
      select: {
        id: true,
        orderNumber: true,
        totalValue: true,
        status: true,
        buyer: { select: { companyName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Fetch recent procurements for supplier-related expenses
    const procurements = await prisma.procurement.findMany({
      where: {
        status: { notIn: ['RECEIVED'] },
      },
      select: {
        id: true,
        poNumber: true,
        totalAmount: true,
        status: true,
        supplier: { select: { id: true, name: true } },
        order: { select: { orderNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Build suggestions based on category
    const suggestions: any[] = [];

    if (category === 'FREIGHT') {
      shipments.forEach(s => {
        if (s.freightCost) {
          suggestions.push({
            type: 'SHIPMENT',
            id: s.id,
            reference: s.shipmentNumber,
            description: `Freight for ${s.order?.orderNumber} - ${s.order?.buyer?.companyName}`,
            amount: Number(s.freightCost),
            vendorName: s.transporter?.name,
            vendorId: s.transporter?.id,
            vendorType: 'TRANSPORTER',
          });
        }
      });
    } else if (category === 'CHA') {
      shipments.forEach(s => {
        if (s.cha) {
          suggestions.push({
            type: 'SHIPMENT',
            id: s.id,
            reference: s.shipmentNumber,
            description: `CHA charges for ${s.order?.orderNumber} - ${s.order?.buyer?.companyName}`,
            amount: null, // CHA rates would need to be looked up
            vendorName: s.cha.name,
            vendorId: s.cha.id,
            vendorType: 'CHA',
          });
        }
      });
    } else if (category === 'TRANSPORT') {
      shipments.forEach(s => {
        if (s.transporter) {
          suggestions.push({
            type: 'SHIPMENT',
            id: s.id,
            reference: s.shipmentNumber,
            description: `Transport for ${s.order?.orderNumber} - ${s.order?.buyer?.companyName}`,
            amount: null,
            vendorName: s.transporter.name,
            vendorId: s.transporter.id,
            vendorType: 'TRANSPORTER',
          });
        }
      });
    }

    // Always include orders and procurements as linkable
    orders.forEach(o => {
      suggestions.push({
        type: 'ORDER',
        id: o.id,
        reference: o.orderNumber,
        description: `Order for ${o.buyer?.companyName}`,
        amount: null,
        status: o.status,
      });
    });

    procurements.forEach(p => {
      if (p.poNumber) {
        suggestions.push({
          type: 'PROCUREMENT',
          id: p.id,
          reference: p.poNumber,
          description: `PO ${p.poNumber} - ${p.supplier?.name} (${p.order?.orderNumber})`,
          amount: Number(p.totalAmount),
          vendorName: p.supplier?.name,
          vendorId: p.supplier?.id,
          vendorType: 'SUPPLIER',
        });
      }
    });

    res.json({ success: true, data: { shipments, orders, procurements, suggestions } });
  } catch (error) {
    next(error);
  }
});

export { router as expenseRouter };
