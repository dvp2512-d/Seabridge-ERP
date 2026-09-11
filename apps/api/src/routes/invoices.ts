import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';
import { generateInvoicePDF, generatePackingListPDF } from '../services/pdfService';
import {
  BASE_CURRENCY_CODE,
  getBaseCurrency,
  resolveDocumentCurrency,
} from '../services/exchangeRateService';
import { emitEvent } from '../services/eventService';
import {
  COMMERCIAL_TYPE_FILTER,
  DOCUMENT_ONLY_INVOICE_TYPES,
  INVOICE_TYPES,
  INVOICE_TYPE_LABELS,
  isDocumentOnlyInvoice,
} from '../utils/invoiceTypes';

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
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.invoice.count({ where }),
      /**
       * Summary figures cover the whole filtered set, not just this page. Every
       * amount is INR, so this is a plain aggregate.
       *
       * Grouped by type as well so proformas can be left out of the money totals:
       * a proforma is a document, not a receivable, and counting it would inflate
       * both what has been invoiced and what is outstanding.
       */
      prisma.invoice.groupBy({
        by: ['status', 'type'],
        where,
        _count: { _all: true },
        _sum: { balanceAmount: true, paidAmount: true, totalAmount: true },
      }),
      prisma.invoice.count({
        where: {
          ...where,
          type: COMMERCIAL_TYPE_FILTER,
          status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
          dueDate: { lt: new Date() },
        },
      }),
    ]);

    /** Every document, for labelling rows. */
    const countByStatus: Record<string, number> = {};
    /**
     * Commercial invoices only, for the payment-oriented cards.
     *
     * A proforma or sample marked SENT has been issued, not left awaiting payment -
     * it will never be paid at all - so counting it as "pending" overstates the work
     * outstanding. The two maps are kept apart rather than one being derived from
     * the other, because the list and the cards genuinely measure different things.
     */
    const countByStatusCommercial: Record<string, number> = {};
    /** Per-type tally of the document-only invoices, so the UI can name what it left out. */
    const countByType: Record<string, number> = {};
    let outstanding = 0;
    let invoiced = 0;
    let collected = 0;
    let documentOnlyCount = 0;

    for (const group of statusGroups) {
      countByStatus[group.status] = (countByStatus[group.status] ?? 0) + group._count._all;

      // Counted in the list, excluded from every money figure.
      if (isDocumentOnlyInvoice(group.type)) {
        documentOnlyCount += group._count._all;
        countByType[group.type] = (countByType[group.type] ?? 0) + group._count._all;
        continue;
      }

      countByStatusCommercial[group.status] =
        (countByStatusCommercial[group.status] ?? 0) + group._count._all;

      invoiced += Number(group._sum.totalAmount ?? 0);
      collected += Number(group._sum.paidAmount ?? 0);
      /**
       * Outstanding means issued and unpaid, which is the same definition the
       * dashboard uses. A DRAFT has not been sent, so nothing is owed on it yet -
       * including drafts here made this card disagree with the dashboard by the
       * value of every unsent invoice.
       */
      if (['SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(group.status)) {
        outstanding += Number(group._sum.balanceAmount ?? 0);
      }
    }

    const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

    res.json({
      success: true,
      data: invoices,
      pagination: { page: Number(page), limit: Number(limit), total },
      summary: {
        baseCurrency: await getBaseCurrency(),
        countByStatus,
        countByStatusCommercial,
        overdueCount,
        /**
         * Money figures cover commercial invoices only. Proformas and sample
         * invoices are documents and create no receivable, so they are counted here
         * but excluded from the totals - stated explicitly, and broken down by type,
         * so the cards and the list cannot appear to disagree.
         */
        documentOnlyCount,
        countByType,
        documentOnlyTypes: [...DOCUMENT_ONLY_INVOICE_TYPES],
        moneyExcludesDocumentOnly: true,
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
        payments: { orderBy: { paymentDate: 'desc' } },
        // Exchange gains booked against this invoice, so the page can show that a
        // surplus has already been recorded rather than offering to book it twice.
        incomeEntries: {
          select: { id: true, incomeNumber: true, category: true, amountINR: true, reference: true },
        },
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
      type: z.enum(INVOICE_TYPES).optional(),
      invoiceDate: z.string().transform(s => new Date(s)).optional(),
      dueDate: z.string().transform(s => new Date(s)),
      taxAmount: z.number().min(0).optional(),
      notes: z.string().optional(),
      // Why a sample carries a declared value but no payment. Shown for SAMPLE
      // documents; ignored on the others, which have no Purpose box.
      purpose: z.string().optional(),
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

    /**
     * A packing list is numbered in its own series.
     *
     * It is a different document from the invoice it accompanies, and a customs
     * officer or shipping line refers to it by its own number. It used to print
     * "PL-" prefixed onto the invoice number, which meant it had no number of its
     * own to be referred to or traced by.
     */
    const type = validation.data.type || 'COMMERCIAL';
    const invoiceNumber =
      type === 'PACKING_LIST'
        ? await generateCode('PACKING_LIST', 'PL')
        : await generateCode('INVOICE', 'INV');
    const subtotal = Number(order.totalValue);
    const taxAmount = validation.data.taxAmount || 0;
    const totalAmount = subtotal + taxAmount;
    const invoiceDate = validation.data.invoiceDate || new Date();

    /**
     * The presentation currency defaults to whatever the originating quotation
     * was printed in, so an invoice follows the document the buyer already has.
     * It stays null until a PDF is generated, at which point the operator confirms
     * or changes the currency and rate. Amounts themselves are INR throughout.
     */
    const quotation = await prisma.quotation.findUnique({
      where: { id: order.quotationId },
      select: { pdfCurrency: true, pdfExchangeRate: true },
    });

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        orderId: order.id,
        buyerId: order.buyerId,
        type: validation.data.type || 'COMMERCIAL',
        invoiceDate,
        dueDate: validation.data.dueDate,
        subtotal,
        taxAmount,
        totalAmount,
        balanceAmount: totalAmount,
        pdfCurrency: quotation?.pdfCurrency ?? null,
        pdfExchangeRate: quotation?.pdfExchangeRate ?? null,
        notes: validation.data.notes,
        purpose: validation.data.purpose,
        termsConditions: validation.data.termsConditions,
      },
      include: {
        buyer: true,
        order: true,
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
      // The Purpose box on a sample invoice, and the delivery/payment terms box.
      // Both are printed, so both need to be correctable after the fact.
      purpose: z.string().nullable().optional(),
      termsConditions: z.string().nullable().optional(),
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
      // INR, like the invoice it settles. Recording the rupee figure the bank
      // actually credited keeps forex gain a difference rather than a derivation.
      amount: z.number().positive(),
      // Optional record of the remittance before conversion, for reconciling
      // against a bank advice. Reference only - `amount` is what totals use.
      receivedCurrency: z.string().min(3).max(3).optional(),
      receivedAmount: z.number().positive().optional(),
      exchangeRate: z.number().positive().optional(),
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

    /**
     * A proforma invoice is a document, not a demand for payment.
     *
     * It is issued so a buyer can open a letter of credit, arrange an advance or
     * clear customs, and it creates no receivable. Payments belong against the
     * commercial invoice that follows it, so recording one here would double-count
     * the sale and leave a balance that can never be reconciled.
     */
    if (isDocumentOnlyInvoice(invoice.type)) {
      const label = (INVOICE_TYPE_LABELS[invoice.type] ?? invoice.type).toLowerCase();
      throw new AppError(
        `${invoice.invoiceNumber} is a ${label}, which is issued for documentation only. ` +
          `Raise the commercial invoice for this order and record the payment against that.`,
        400
      );
    }

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

    /**
     * When the remittance details are supplied, they must actually produce the
     * rupee figure being stored. Accepting a mismatch would leave an entry whose
     * own numbers contradict each other, which is worse than rejecting it: the
     * reference fields exist precisely so a bank advice can be tied to the entry.
     */
    const { receivedCurrency, receivedAmount, exchangeRate } = validation.data;
    const anyRemittanceField =
      receivedCurrency !== undefined || receivedAmount !== undefined || exchangeRate !== undefined;

    if (anyRemittanceField) {
      if (receivedCurrency === undefined || receivedAmount === undefined || exchangeRate === undefined) {
        throw new AppError(
          'To record a remittance, give the currency, the amount received and the rate together.',
          400
        );
      }
      await resolveDocumentCurrency(receivedCurrency, exchangeRate);
      const implied = Math.round((receivedAmount * exchangeRate + Number.EPSILON) * 100) / 100;
      /**
       * Tolerance is one hundredth of a foreign unit, because that is the finest a
       * two-decimal foreign amount can express. A flat one-rupee allowance was too
       * tight for a high-value currency and too loose for a low-value one.
       */
      const tolerance = Math.max(1, exchangeRate * 0.01);

      /**
       * A remittance worth MORE than the amount recorded is allowed when that
       * amount settles the invoice.
       *
       * If the buyer sends the agreed 10,000 USD and the rate has moved in your
       * favour, the rupees received exceed the rupee balance. The invoice is still
       * settled in full - they paid what was asked - and the surplus is a realised
       * exchange gain booked as other income, not part of this invoice. Requiring
       * an exact match rejected that perfectly ordinary case.
       */
      const settlesInvoice = Math.abs(validation.data.amount - balance) <= tolerance;
      const surplusOnSettlement = settlesInvoice && implied > validation.data.amount;

      if (!surplusOnSettlement && Math.abs(implied - validation.data.amount) > tolerance) {
        throw new AppError(
          `${receivedAmount} ${receivedCurrency.toUpperCase()} at ${exchangeRate} comes to ${implied}, ` +
            `but the amount being recorded is ${validation.data.amount}.`,
          400
        );
      }
    }

    const paymentNumber = await generateCode('PAYMENT', 'PAY');

    const newPaidAmount = Number(invoice.paidAmount) + validation.data.amount;
    const newBalanceAmount = Math.max(0, Number(invoice.totalAmount) - newPaidAmount);
    /**
     * A residue of under a rupee is rounding, not an unpaid invoice.
     *
     * A foreign remittance converted at two decimals rarely lands exactly on the
     * rupee balance, and a 0.21 residue used to leave the invoice PARTIALLY_PAID
     * forever - it could never be closed, because no sensible payment settles
     * twenty paise. The threshold was 0.01, which only absorbed float noise.
     */
    const newStatus = newBalanceAmount < 1 ? 'PAID' : 'PARTIALLY_PAID';
    // Once settled the residue is written off, so the page cannot show "PAID"
    // next to a balance still outstanding in red.
    const storedBalance = newStatus === 'PAID' ? 0 : newBalanceAmount;

    /**
     * Rupees received beyond what the invoice asked for.
     *
     * When the buyer sends the agreed foreign amount and the rate has moved in the
     * exporter's favour, more rupees arrive than the invoice was worth. Only the
     * invoice value clears the receivable; the excess is a realised exchange gain.
     *
     * It is booked as other income automatically, in the same transaction, because
     * it is not a judgement call - the cash arrived and the invoice is settled, so
     * leaving it to a separate manual step only risks understating income.
     */
    const remittanceWorth =
      receivedAmount !== undefined && exchangeRate !== undefined
        ? Math.round((receivedAmount * exchangeRate + Number.EPSILON) * 100) / 100
        : null;
    const exchangeGain =
      remittanceWorth !== null
        ? Math.round((remittanceWorth - validation.data.amount + Number.EPSILON) * 100) / 100
        : 0;
    // Under a rupee is rounding, not a gain worth booking.
    const gainToBook = exchangeGain > 1 ? exchangeGain : 0;
    const incomeNumber = gainToBook > 0 ? await generateCode('INCOME', 'INC') : null;

    // Payment, invoice rollup and buyer revenue must all move together.
    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          ...validation.data,
          receivedCurrency: receivedCurrency?.toUpperCase(),
          invoiceId: req.params.id,
          paymentNumber,
        },
      });

      if (gainToBook > 0 && incomeNumber) {
        await tx.income.create({
          data: {
            incomeNumber,
            category: 'FOREX_GAIN',
            description: `Exchange gain on ${invoice.invoiceNumber} (${paymentNumber})`,
            // Already rupees, so it is recorded at a rate of 1 rather than
            // converted a second time.
            originalAmount: gainToBook,
            originalCurrency: 'INR',
            exchangeRate: 1,
            amountINR: gainToBook,
            receivedDate: validation.data.paymentDate,
            reference: paymentNumber,
            // Required for this category, so the figure stays traceable.
            linkedInvoiceId: invoice.id,
            status: 'RECEIVED',
            createdById: req.user!.id,
          },
        });
      }

      await tx.invoice.update({
        where: { id: req.params.id },
        data: {
          paidAmount: newPaidAmount,
          balanceAmount: storedBalance,
          status: newStatus,
        },
      });

      // Both figures are INR, so the running total is a straight increment.
      await tx.buyer.update({
        where: { id: invoice.buyerId },
        data: { totalRevenue: { increment: validation.data.amount } },
      });

      return created;
    });

    res.status(201).json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
});

/**
 * Generate the invoice PDF in a chosen currency.
 *
 * Amounts are stored in INR; the currency and rate decide only how the buyer's
 * copy reads. Both are recorded on the invoice so a reprint reproduces the
 * document that was sent, and so the rate used is auditable. Omit them to reuse
 * whatever the invoice was last generated with, defaulting to INR.
 */
router.get('/:id/pdf', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        buyer: { include: { country: true } },
        order: {
          include: {
            items: { include: { product: true } },
            incoterm: true,
            portOfLoading: true,
            portOfDischarge: true,
            // The party invoiced when it differs from the consignee.
            billToBuyer: { include: { country: true } },
            // Sibling invoices, so a packing list can name the commercial invoice
            // it accompanies.
            invoices: { select: { id: true, invoiceNumber: true, type: true } },
            shipments: {
              include: {
                originPort: true,
                destinationPort: true,
              },
              take: 1,
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!invoice) throw new NotFoundError('Invoice');

    const requestedCode =
      (req.query.currency as string | undefined) ?? invoice.pdfCurrency ?? BASE_CURRENCY_CODE;
    const requestedRate =
      req.query.rate !== undefined
        ? Number(req.query.rate)
        : invoice.pdfExchangeRate !== null
          ? Number(invoice.pdfExchangeRate)
          : 1;

    const currency = await resolveDocumentCurrency(requestedCode, requestedRate);

    // Record what this copy was produced in, so it can be reproduced.
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        pdfCurrency: currency.code,
        pdfExchangeRate: requestedRate,
        pdfGeneratedAt: new Date(),
      },
      include: {
        buyer: { include: { country: true } },
        order: {
          include: {
            items: { include: { product: true } },
            incoterm: true,
            portOfLoading: true,
            portOfDischarge: true,
            // The party invoiced when it differs from the consignee.
            billToBuyer: { include: { country: true } },
            // Sibling invoices, so a packing list can name the commercial invoice
            // it accompanies.
            invoices: { select: { id: true, invoiceNumber: true, type: true } },
            shipments: {
              include: {
                originPort: true,
                destinationPort: true,
              },
              take: 1,
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    const companyProfile = await prisma.companyProfile.findFirst();

    // Use the appropriate PDF generator based on invoice type
    const pdfOptions = {
      currencyCode: currency.code,
      currencySymbol: currency.symbol,
      rate: requestedRate,
      companyProfile,
    };
    
    const pdfBuffer = updated.type === 'PACKING_LIST'
      ? await generatePackingListPDF(updated, pdfOptions)
      : await generateInvoicePDF(updated, pdfOptions);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

// Receivables summary. Every balance is INR, so this is a straight sum.
router.get('/reports/receivables', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const [receivables, base] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          // A proforma is a document, not a receivable.
          type: COMMERCIAL_TYPE_FILTER,
          status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
          balanceAmount: { gt: 0 },
        },
        include: { buyer: { select: { id: true, companyName: true } } },
        orderBy: { dueDate: 'asc' },
      }),
      getBaseCurrency(),
    ]);

    const total = receivables.reduce((sum, inv) => sum + Number(inv.balanceAmount), 0);

    res.json({
      success: true,
      data: {
        baseCurrency: base,
        totalOutstanding: Math.round((total + Number.EPSILON) * 100) / 100,
        count: receivables.length,
        overdue: receivables.filter((inv) => new Date(inv.dueDate) < new Date()),
        invoices: receivables,
      },
    });
  } catch (error) {
    next(error);
  }
});

export { router as invoiceRouter };
