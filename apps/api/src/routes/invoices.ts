import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';
import {
  buildRateMap,
  findRate,
  getBaseCurrency,
  toBaseCurrency,
} from '../services/exchangeRateService';
import { emitEvent } from '../services/eventService';
import {
  buildCommercialInvoiceDocument,
  buildProformaInvoiceDocument,
  buildSampleInvoiceDocument,
} from '../services/exportDocuments';

const router: Router = Router();

router.use(authenticate);

// List invoices
router.get('/', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const { status, buyerId, search, page = 1, limit = 50 } = req.query;

    const where: any = {};
    if (status) where.status = status;
    if (buyerId) where.buyerId = buyerId;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search as string, mode: 'insensitive' } },
        { buyer: { companyName: { contains: search as string, mode: 'insensitive' } } },
      ];
    }

    const [invoices, total, statusGroups, overdueCount] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          buyer: { select: { id: true, companyName: true, code: true } },
          order: { select: { id: true, orderNumber: true } },
          currency: { select: { id: true, code: true, symbol: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.invoice.count({ where }),
      // Summary figures must cover the whole filtered set, not just this page,
      // otherwise the dashboard cards understate receivables. Grouped by currency
      // as well so the money can be converted before being totalled - invoices
      // in different currencies cannot simply be added.
      prisma.invoice.groupBy({
        by: ['status', 'currencyId'],
        where,
        _count: { _all: true },
        _sum: { balanceAmount: true, paidAmount: true, totalAmount: true },
      }),
      prisma.invoice.count({
        where: {
          ...where,
          status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
          dueDate: { lt: new Date() },
        },
      }),
    ]);

    // Fold the currency dimension away, converting as we go. Records whose
    // currency has no notified rate are counted so the UI can say the totals are
    // incomplete instead of showing a smaller number as if it were the whole set.
    const { base, rates } = await buildRateMap(new Date());

    const countByStatus: Record<string, number> = {};
    let outstanding = 0;
    let invoiced = 0;
    let collected = 0;
    let unconverted = 0;

    for (const group of statusGroups) {
      countByStatus[group.status] = (countByStatus[group.status] ?? 0) + group._count._all;

      const rate = rates.get(group.currencyId);
      if (rate === undefined) {
        unconverted += group._count._all;
        continue;
      }

      invoiced += Number(group._sum.totalAmount ?? 0) * rate;
      collected += Number(group._sum.paidAmount ?? 0) * rate;
      if (!['PAID', 'CANCELLED'].includes(group.status)) {
        outstanding += Number(group._sum.balanceAmount ?? 0) * rate;
      }
    }

    const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

    res.json({
      success: true,
      data: invoices,
      pagination: { page: Number(page), limit: Number(limit), total },
      summary: {
        // Every money figure here is in this currency, not the invoice's own.
        baseCurrency: base,
        unconvertedRecords: unconverted,
        countByStatus,
        overdueCount,
        totalInvoiced: round2(invoiced),
        totalCollected: round2(collected),
        totalOutstanding: round2(outstanding),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get invoice detail
router.get('/:id', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        buyer: { include: { country: true } },
        order: { include: { items: { include: { product: true } } } },
        currency: true,
        payments: { orderBy: { paymentDate: 'desc' } },
      },
    });

    if (!invoice) throw new NotFoundError('Invoice');
    res.json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
});

// Create invoice from order
router.post('/', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      orderId: z.string().min(1),
      type: z.enum(['EXPORT', 'PROFORMA', 'SAMPLE']).optional(),
      invoiceDate: z.string().transform(s => new Date(s)).optional(),
      dueDate: z.string().transform(s => new Date(s)),
      taxAmount: z.number().min(0).optional(),
      notes: z.string().optional(),
      termsConditions: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    // Get order
    const order = await prisma.exportOrder.findUnique({
      where: { id: validation.data.orderId },
      include: { buyer: true },
    });

    if (!order) throw new NotFoundError('Order');

    // Resolve the order's currency to a Currency row. Never fall back to an
    // empty string - that would violate the foreign key at write time.
    const currency = await prisma.currency.findFirst({
      where: { code: order.currency },
    });

    if (!currency) {
      throw new AppError(
        `Currency "${order.currency}" is not configured in Master Data. Add it before invoicing.`,
        400
      );
    }

    const invoiceNumber = await generateCode('INVOICE', 'INV');
    const subtotal = Number(order.totalValue);
    const taxAmount = validation.data.taxAmount || 0;
    const totalAmount = subtotal + taxAmount;
    const invoiceDate = validation.data.invoiceDate || new Date();

    /**
     * Stamp the notified rate in force on the invoice date.
     *
     * Recorded on the invoice rather than looked up at print time so reprinting
     * later gives the same rupee value, even after a new notification supersedes
     * the rate. A missing rate is not fatal here - the invoice is still valid,
     * it simply cannot show a rupee valuation until the rate is entered.
     */
    let exchangeRate = 1;
    let exchangeRateRef: string | null = null;
    let exchangeRateDate: Date | null = null;

    const base = await prisma.currency.findFirst({ where: { isBaseCurrency: true } });
    if (base && currency.id !== base.id) {
      const resolved = await findRate(currency.id, invoiceDate, 'EXPORT');
      if (resolved) {
        exchangeRate = resolved.rate;
        exchangeRateRef = resolved.notificationRef;
        exchangeRateDate = resolved.effectiveFrom;
      }
    }

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        orderId: order.id,
        buyerId: order.buyerId,
        currencyId: currency.id,
        type: validation.data.type || 'EXPORT',
        invoiceDate,
        dueDate: validation.data.dueDate,
        subtotal,
        taxAmount,
        totalAmount,
        balanceAmount: totalAmount,
        exchangeRate,
        exchangeRateRef,
        exchangeRateDate,
        notes: validation.data.notes,
        termsConditions: validation.data.termsConditions,
      },
      include: {
        buyer: true,
        order: true,
        currency: true,
      },
    });

    emitEvent('invoice.created', invoice);

    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
});

// Update invoice
router.put('/:id', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
      dueDate: z.string().transform(s => new Date(s)).optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const updateData: any = { ...validation.data };
    if (validation.data.status === 'SENT') {
      updateData.sentAt = new Date();
    }

    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
});

/**
 * Record a payment against an invoice.
 *
 * CONCURRENCY SAFETY:
 * This endpoint uses two mechanisms to prevent payment errors:
 *
 * 1. IDEMPOTENCY KEY: If the client provides an idempotencyKey, a duplicate
 *    request returns the existing payment instead of creating another. This
 *    protects against double-clicks, network retries, and impatient users.
 *
 * 2. SELECT FOR UPDATE: The invoice row is locked inside the transaction before
 *    reading the balance. Two concurrent payments cannot both read the same
 *    balance and both proceed — one will wait for the other's lock, then see
 *    the updated balance.
 *
 * Without these, two $700 payments against a $1000 balance could both succeed,
 * leaving the invoice with -$400 balance.
 */
router.post('/:id/payments', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      amount: z.number().positive(),
      currency: z.string().optional(),
      /**
       * Rupees per unit of the payment currency, as actually realised.
       *
       * Left to the caller because the rate that matters here is what the bank
       * gave, which no notified rate table knows. When omitted it falls back to
       * the notified rate on the payment date, so the figure is at least
       * defensible rather than the previous default of 1.0 - which made a USD
       * payment look as though a dollar were a rupee and rendered any forex gain
       * calculation meaningless.
       */
      exchangeRate: z.number().positive().optional(),
      paymentDate: z.string().transform(s => new Date(s)),
      paymentMode: z.string().min(1),
      reference: z.string().optional(),
      bankDetails: z.string().optional(),
      notes: z.string().optional(),
      /**
       * Client-generated unique key for duplicate prevention.
       * If provided, a second request with the same key returns the existing
       * payment instead of creating a duplicate.
       */
      idempotencyKey: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const { idempotencyKey, ...paymentData } = validation.data;

    // ─── IDEMPOTENCY CHECK ──────────────────────────────────────────────────
    // If the client sent an idempotency key, check if we already processed it.
    // Return the existing payment rather than creating a duplicate.
    if (idempotencyKey) {
      const existing = await prisma.payment.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return res.status(200).json({
          success: true,
          data: existing,
          message: 'Payment already recorded (idempotent response)',
        });
      }
    }

    // ─── PRE-TRANSACTION LOOKUPS ────────────────────────────────────────────
    // These reads happen outside the transaction to avoid holding locks while
    // doing network I/O (exchange rate lookups).

    // Basic invoice existence check (the real balance check is inside the txn)
    const invoiceCheck = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, currencyId: true, exchangeRate: true, buyerId: true },
    });

    if (!invoiceCheck) throw new NotFoundError('Invoice');

    if (invoiceCheck.status === 'CANCELLED') {
      throw new AppError('Cannot record a payment against a cancelled invoice', 400);
    }

    // Resolve the exchange rate before entering the transaction
    let paymentRate = paymentData.exchangeRate;
    if (paymentRate === undefined) {
      const base = await prisma.currency.findFirst({ where: { isBaseCurrency: true } });
      if (base && invoiceCheck.currencyId === base.id) {
        paymentRate = 1;
      } else {
        const resolved = await findRate(
          invoiceCheck.currencyId,
          paymentData.paymentDate,
          'EXPORT'
        );
        paymentRate = resolved?.rate ?? Number(invoiceCheck.exchangeRate ?? 1);
      }
    }

    // Convert payment to base currency for buyer revenue
    let revenueInBase = 0;
    try {
      const converted = await toBaseCurrency(
        paymentData.amount,
        invoiceCheck.currencyId,
        paymentData.paymentDate ?? new Date()
      );
      revenueInBase = converted.amount;
    } catch {
      console.warn(
        `[payment] no exchange rate for ${invoiceCheck.currencyId}; buyer revenue not incremented`
      );
    }

    // Generate payment number before transaction (uses its own atomic SQL)
    const paymentNumber = await generateCode('PAYMENT', 'PAY');

    // ─── TRANSACTION WITH ROW LOCKING ───────────────────────────────────────
    // SELECT FOR UPDATE locks the invoice row so concurrent payments see the
    // updated balance, not the stale one.
    const result = await prisma.$transaction(async (tx) => {
      // Lock the invoice row and get the CURRENT balance (not stale)
      const [lockedInvoice] = await tx.$queryRaw<
        { id: string; balance_amount: string; paid_amount: string; total_amount: string; buyer_id: string }[]
      >`
        SELECT id, balance_amount, paid_amount, total_amount, buyer_id
        FROM invoices
        WHERE id = ${req.params.id}
        FOR UPDATE
      `;

      if (!lockedInvoice) {
        throw new NotFoundError('Invoice');
      }

      const currentBalance = Number(lockedInvoice.balance_amount);
      const currentPaid = Number(lockedInvoice.paid_amount);
      const totalAmount = Number(lockedInvoice.total_amount);

      // Check balance AFTER acquiring lock — this is the real check
      if (paymentData.amount > currentBalance + 0.01) {
        throw new AppError(
          `Payment of ${paymentData.amount} exceeds the outstanding balance of ${currentBalance}`,
          400
        );
      }

      const newPaidAmount = currentPaid + paymentData.amount;
      const newBalanceAmount = Math.max(0, totalAmount - newPaidAmount);
      const newStatus = newBalanceAmount <= 0.01 ? 'PAID' : 'PARTIALLY_PAID';

      // Create the payment
      const created = await tx.payment.create({
        data: {
          invoiceId: req.params.id,
          paymentNumber,
          amount: paymentData.amount,
          currency: paymentData.currency,
          exchangeRate: paymentRate,
          paymentDate: paymentData.paymentDate,
          paymentMode: paymentData.paymentMode,
          reference: paymentData.reference,
          bankDetails: paymentData.bankDetails,
          notes: paymentData.notes,
          idempotencyKey: idempotencyKey ?? null,
        },
      });

      // Update invoice balances
      await tx.invoice.update({
        where: { id: req.params.id },
        data: {
          paidAmount: newPaidAmount,
          balanceAmount: newBalanceAmount,
          status: newStatus,
        },
      });

      // Update buyer revenue (converted to base currency)
      if (revenueInBase > 0) {
        await tx.buyer.update({
          where: { id: lockedInvoice.buyer_id },
          data: { totalRevenue: { increment: revenueInBase } },
        });
      }

      return { payment: created, newStatus, invoiceNumber: '' };
    });

    // Get invoice number for the event (outside transaction)
    const invoiceForEvent = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      select: { invoiceNumber: true },
    });

    // Notify after the transaction commits
    emitEvent('payment.recorded', result.payment);
    if (result.newStatus === 'PAID') {
      emitEvent('invoice.paid', {
        id: req.params.id,
        invoiceNumber: invoiceForEvent?.invoiceNumber,
      });
    }

    res.status(201).json({ success: true, data: result.payment });
  } catch (error) {
    next(error);
  }
});

// Generate PDF.
// The template used follows the invoice type: EXPORT renders the Commercial
// Invoice, PROFORMA the Proforma, SAMPLE the Sample Invoice. All three follow
// the layout in MASTER DRAFT.xlsx.
router.get('/:id/pdf', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        buyer: { include: { country: true, contacts: { where: { isPrimary: true } } } },
        order: {
          include: {
            items: { include: { product: true } },
            shipments: { include: { originPort: true, destinationPort: true } },
            portOfLoading: { include: { country: true } },
            portOfDischarge: { include: { country: true } },
          },
        },
        currency: true,
      },
    });

    if (!invoice) throw new NotFoundError('Invoice');

    const company = await prisma.companyProfile.findFirst();
    if (!company) {
      throw new AppError(
        'Company profile is not set up. Seed the database or add it in Settings before generating documents.',
        400
      );
    }

    const builder =
      invoice.type === 'PROFORMA'
        ? buildProformaInvoiceDocument
        : invoice.type === 'SAMPLE'
        ? buildSampleInvoiceDocument
        : buildCommercialInvoiceDocument;

    // The rate line needs to name the currency it converts into, and that comes
    // from the base currency flag rather than a hardcoded 'INR'.
    const base = await getBaseCurrency();
    const pdfBuffer = await builder(invoice, { ...company, baseCurrencyCode: base.code });

    const label =
      invoice.type === 'PROFORMA' ? 'Proforma' : invoice.type === 'SAMPLE' ? 'Sample' : 'Commercial';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${label}-${invoice.invoiceNumber}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

// Receivables summary
//
// totalOutstanding is expressed in the application's base currency (INR by
// default) so the single number is always meaningful regardless of how many
// different invoice currencies are in flight. Individual invoice balances are
// left in their original currencies; only the aggregate is converted.
//
// Design follows the same pattern as the main invoice list summary and the
// dashboard's totalReceivables card: buildRateMap fetches every rate in one
// query, then each row's balanceAmount is multiplied by the relevant rate.
// Rows whose currency has no rate in force today are counted and reported as
// unconvertedRecords rather than silently excluded - this matches the
// UnconvertedNotice component pattern already used on the Invoices page.
router.get('/reports/receivables', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const receivables = await prisma.invoice.findMany({
      where: {
        status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
        balanceAmount: { gt: 0 },
      },
      include: {
        buyer: { select: { id: true, companyName: true } },
        currency: { select: { id: true, code: true, symbol: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Build a rate map keyed by currency id using today's date.
    // This is the same call made by the main invoice list endpoint - we
    // deliberately do NOT create a second implementation of this logic.
    const { base, rates } = await buildRateMap(new Date());

    const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

    let totalOutstanding = 0;
    let unconvertedRecords = 0;
    const now = new Date();

    for (const inv of receivables) {
      const rate = rates.get(inv.currencyId);
      if (rate === undefined) {
        // Count but do not add at face value - adding, say, 1000 USD to a
        // running INR total would produce a number that is neither USD nor INR.
        unconvertedRecords++;
        continue;
      }
      totalOutstanding += Number(inv.balanceAmount) * rate;
    }

    const summary = {
      // All-currencies total expressed in the base currency (INR).
      // The caller must not display this without the baseCurrency label.
      baseCurrency: base,
      totalOutstanding: round2(totalOutstanding),
      // Non-zero means some invoices had no exchange rate and are omitted from
      // the total. The UI should surface this rather than showing a lower
      // number as if it were the complete figure.
      unconvertedRecords,
      count: receivables.length,
      overdue: receivables.filter(inv => inv.dueDate < now),
      // Individual invoice rows keep their original currencies; only the
      // aggregate is converted.
      invoices: receivables,
    };

    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
});

export { router as invoiceRouter };
