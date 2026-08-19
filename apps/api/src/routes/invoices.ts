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

// Record payment
router.post('/:id/payments', can('FINANCE_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      amount: z.number().positive(),
      currency: z.string().optional(),
      exchangeRate: z.number().optional(),
      paymentDate: z.string().transform(s => new Date(s)),
      paymentMode: z.string().min(1),
      reference: z.string().optional(),
      bankDetails: z.string().optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
    });

    if (!invoice) throw new NotFoundError('Invoice');

    if (invoice.status === 'CANCELLED') {
      throw new AppError('Cannot record a payment against a cancelled invoice', 400);
    }

    const balance = Number(invoice.balanceAmount);
    // Allow a tiny rounding tolerance but block genuine overpayment.
    if (validation.data.amount > balance + 0.01) {
      throw new AppError(
        `Payment of ${validation.data.amount} exceeds the outstanding balance of ${balance}`,
        400
      );
    }

    const paymentNumber = await generateCode('PAYMENT', 'PAY');

    const newPaidAmount = Number(invoice.paidAmount) + validation.data.amount;
    const newBalanceAmount = Math.max(0, Number(invoice.totalAmount) - newPaidAmount);
    const newStatus = newBalanceAmount <= 0.01 ? 'PAID' : 'PARTIALLY_PAID';

    /**
     * Convert the payment into the base currency for the buyer's running revenue
     * total. Resolved before the transaction so a rate lookup cannot hold a
     * database transaction open.
     *
     * A payment in a currency with no notified rate still records correctly; it
     * simply does not move the revenue figure, which is better than corrupting it
     * with an unconverted amount.
     */
    let revenueInBase = 0;
    try {
      const converted = await toBaseCurrency(
        validation.data.amount,
        invoice.currencyId,
        validation.data.paymentDate ?? new Date()
      );
      revenueInBase = converted.amount;
    } catch {
      console.warn(
        `[payment] no exchange rate for ${invoice.currencyId} on the payment date; buyer revenue not incremented`
      );
    }

    // Payment, invoice rollup and buyer revenue must all move together.
    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          ...validation.data,
          invoiceId: req.params.id,
          paymentNumber,
        },
      });

      await tx.invoice.update({
        where: { id: req.params.id },
        data: {
          paidAmount: newPaidAmount,
          balanceAmount: newBalanceAmount,
          status: newStatus,
        },
      });

      // Buyer revenue accumulates across many payments, which may be in
      // different currencies, so it is converted into the base currency first.
      // Incrementing with the raw amount made "top buyers by revenue" a ranking
      // of mixed units.
      await tx.buyer.update({
        where: { id: invoice.buyerId },
        data: { totalRevenue: { increment: revenueInBase } },
      });

      return created;
    });

    // Notify after the transaction commits, so a webhook can never observe a
    // payment that was subsequently rolled back.
    emitEvent('payment.recorded', payment);
    if (newStatus === 'PAID') {
      emitEvent('invoice.paid', { id: req.params.id, invoiceNumber: invoice.invoiceNumber });
    }

    res.status(201).json({ success: true, data: payment });
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
router.get('/reports/receivables', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const receivables = await prisma.invoice.findMany({
      where: {
        status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
        balanceAmount: { gt: 0 },
      },
      include: {
        buyer: { select: { id: true, companyName: true } },
        currency: { select: { code: true, symbol: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    const summary = {
      totalOutstanding: receivables.reduce((sum, inv) => sum + Number(inv.balanceAmount), 0),
      count: receivables.length,
      overdue: receivables.filter(inv => new Date(inv.dueDate) < new Date()),
      invoices: receivables,
    };

    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
});

export { router as invoiceRouter };
