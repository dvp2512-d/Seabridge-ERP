import { Router } from 'express';
import { z } from 'zod';
import { prisma, Prisma, InquiryStage } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode, calculateMarginPercent } from '../utils/helpers';
import { generateQuotationPDF } from '../services/pdfService';
import {
  BASE_CURRENCY_CODE,
  getBaseCurrency,
  resolveDocumentCurrency,
} from '../services/exchangeRateService';
import { emitEvent } from '../services/eventService';
import { createOrderFromQuotation } from '../services/orderService';

const router: Router = Router();

router.use(authenticate);

// List quotations
router.get('/', can('SALES_VIEW'), async (req, res, next) => {
  try {
    const { status, buyerId, search, page = 1, limit = 50 } = req.query;

    const where: any = {};
    if (status) where.status = status;
    if (buyerId) where.buyerId = buyerId;
    if (search) {
      where.OR = [
        { quotationNumber: { contains: search as string, mode: 'insensitive' } },
        { buyer: { companyName: { contains: search as string, mode: 'insensitive' } } },
      ];
    }

    const [quotations, total, statusGroups] = await Promise.all([
      prisma.quotation.findMany({
        where,
        include: {
          buyer: { select: { id: true, companyName: true, code: true } },
          incoterm: { select: { id: true, code: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.quotation.count({ where }),
      // Every amount is INR, so this is a plain aggregate over the whole filtered
      // set - the summary cards stay correct while the list is paginated.
      prisma.quotation.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { grandTotal: true },
      }),
    ]);

    const countByStatus: Record<string, number> = {};
    let totalValue = 0;

    for (const group of statusGroups) {
      countByStatus[group.status] = group._count._all;
      totalValue += Number(group._sum.grandTotal ?? 0);
    }

    res.json({
      success: true,
      data: quotations,
      pagination: { page: Number(page), limit: Number(limit), total },
      summary: {
        baseCurrency: await getBaseCurrency(),
        countByStatus,
        totalValue: Math.round((totalValue + Number.EPSILON) * 100) / 100,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get quotation detail
router.get('/:id', can('SALES_VIEW'), async (req, res, next) => {
  try {
    const quotation = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: {
        buyer: { include: { country: true, contacts: { where: { isPrimary: true } } } },
        inquiry: { select: { id: true, inquiryNumber: true } },
        incoterm: true,
        portOfLoading: true,
        portOfDischarge: true,
        items: { include: { product: true } },
        costs: true,
        // Needed so the UI can tell whether this quotation is already an order.
        orders: { select: { id: true, orderNumber: true, status: true } },
      },
    });

    if (!quotation) throw new NotFoundError('Quotation');
    res.json({ success: true, data: quotation });
  } catch (error) {
    next(error);
  }
});

// Create quotation
router.post('/', can('SALES_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      inquiryId: z.string().optional(),
      buyerId: z.string().min(1),
      incotermId: z.string().min(1),
      portOfLoadingId: z.string().optional(),
      portOfDischargeId: z.string().optional(),
      validUntil: z.string().transform(s => new Date(s)),
      deliveryTerms: z.string().optional(),
      paymentTerms: z.string().optional(),
      notes: z.string().optional(),
      termsConditions: z.string().optional(),
      items: z.array(z.object({
        productId: z.string().min(1),
        quantity: z.number().finite().positive(),
        unit: z.string().optional(),
        unitCost: z.number().finite().min(0),
        // Selling price per unit, derived on the client from the item's own
        // margin: price = cost / (1 - margin). Each line carries its own price,
        // so a cheap line and an expensive line are never priced alike.
        unitPrice: z.number().finite().positive(),
        specifications: z.string().optional(),
      })).min(1),
      costs: z.array(z.object({
        costType: z.string().min(1),
        description: z.string().min(1),
        amount: z.number().finite().min(0),
      })).optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const { items, costs, ...data } = validation.data;
    const quotationNumber = await generateCode('QUOTATION', 'QT');

    /**
     * Quotation totals.
     *
     * Each line carries its own selling price, derived from its own margin, so
     * the margin on a line always reflects that line's cost.
     *
     *   subtotal    = sum of (unitPrice x quantity)     the goods, as quoted
     *   itemsCost   = sum of (unitCost  x quantity)     what the goods cost us
     *   totalCost   = itemsCost + additionalCosts       what the job costs us
     *   totalMargin = subtotal - itemsCost              margin from line items only
     *   grandTotal  = subtotal + additionalCosts        what the buyer pays
     *
     * Additional costs (CHA, transport, insurance...) are recorded under total
     * cost and billed on to the buyer, but they do NOT earn margin. Margin comes
     * from the line items only, so adding a shipment cost never reduces it.
     */
    let subtotal = 0;
    let itemsCost = 0;
    const processedItems = items.map(item => {
      const itemTotalCost = item.unitCost * item.quantity;
      const itemTotalPrice = item.unitPrice * item.quantity;
      const margin = itemTotalPrice - itemTotalCost;
      const marginPercent = calculateMarginPercent(itemTotalCost, itemTotalPrice);

      subtotal += itemTotalPrice;
      itemsCost += itemTotalCost;

      return {
        ...item,
        totalCost: itemTotalCost,
        totalPrice: itemTotalPrice,
        margin,
        marginPercent,
      };
    });

    const additionalCosts = costs?.reduce((sum, c) => sum + c.amount, 0) || 0;

    const totalCost = itemsCost + additionalCosts;
    const totalMargin = subtotal - itemsCost;
    const grandTotal = subtotal + additionalCosts;
    const marginPercent = calculateMarginPercent(itemsCost, subtotal);

    const quotation = await prisma.quotation.create({
      data: {
        ...data,
        quotationNumber,
        subtotal,
        totalCost,
        totalMargin,
        marginPercent,
        grandTotal,
        items: { create: processedItems },
        costs: costs ? { create: costs } : undefined,
      },
      include: {
        buyer: true,
        incoterm: true,
        items: { include: { product: true } },
        costs: true,
      },
    });

    // Update inquiry stage if linked
    if (data.inquiryId) {
      await prisma.inquiry.update({
        where: { id: data.inquiryId },
        data: { stage: 'QUOTATION_SENT' },
      });
    }

    emitEvent('quotation.created', quotation);
    res.status(201).json({ success: true, data: quotation });
  } catch (error) {
    next(error);
  }
});

// Update quotation
router.put('/:id', can('SALES_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['DRAFT', 'SENT', 'REVISED', 'ACCEPTED', 'REJECTED', 'EXPIRED']).optional(),
      validUntil: z.string().transform(s => new Date(s)).optional(),
      deliveryTerms: z.string().optional(),
      paymentTerms: z.string().optional(),
      notes: z.string().optional(),
      termsConditions: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const updateData: any = { ...validation.data };
    if (validation.data.status === 'SENT') {
      updateData.sentAt = new Date();
    }
    if (validation.data.status === 'ACCEPTED') {
      updateData.acceptedAt = new Date();
    }

    const quotation = await prisma.quotation.update({
      where: { id: req.params.id },
      data: updateData,
      include: { buyer: true, incoterm: true },
    });

    res.json({ success: true, data: quotation });
  } catch (error) {
    next(error);
  }
});

// Update status
router.patch('/:id/status', can('SALES_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['DRAFT', 'SENT', 'REVISED', 'ACCEPTED', 'REJECTED', 'EXPIRED']),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const { status, notes } = validation.data;

    const existing = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      select: { id: true, notes: true },
    });
    if (!existing) throw new NotFoundError('Quotation');

    const updateData: Prisma.QuotationUpdateInput = { status };
    if (status === 'SENT') updateData.sentAt = new Date();
    if (status === 'ACCEPTED') updateData.acceptedAt = new Date();
    // Append any status note so the reason for rejection isn't lost.
    if (notes) {
      updateData.notes = existing.notes ? `${existing.notes}\n${notes}` : notes;
    }

    const quotation = await prisma.quotation.update({
      where: { id: req.params.id },
      data: updateData,
      include: { buyer: true, incoterm: true },
    });

    // Keep the linked inquiry's pipeline stage in sync.
    if (quotation.inquiryId) {
      const stageByStatus: Partial<Record<typeof status, InquiryStage>> = {
        SENT: 'QUOTATION_SENT',
        ACCEPTED: 'WON',
        REJECTED: 'LOST',
      };
      const nextStage = stageByStatus[status];

      if (nextStage) {
        await prisma.inquiry.update({
          where: { id: quotation.inquiryId },
          data: {
            stage: nextStage,
            ...(nextStage === 'WON' || nextStage === 'LOST'
              ? { closedAt: new Date() }
              : {}),
            ...(nextStage === 'LOST' && notes ? { lostReason: notes } : {}),
          },
        });
      }
    }

    res.json({ success: true, data: quotation });
  } catch (error) {
    next(error);
  }
});

// Convert an accepted quotation into an export order
router.post('/:id/convert-to-order', can('SALES_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      expectedDeliveryDate: z.string().optional(),
      poNumber: z.string().optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const quotation = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    });

    if (!quotation) throw new NotFoundError('Quotation');
    if (quotation.status !== 'ACCEPTED') {
      throw new AppError('Quotation must be accepted before converting to an order', 400);
    }

    const order = await createOrderFromQuotation(quotation.id, {
      expectedDate: validation.data.expectedDeliveryDate
        ? new Date(validation.data.expectedDeliveryDate)
        : undefined,
      poNumber: validation.data.poNumber,
      notes: validation.data.notes,
    });

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
});

// Generate PDF
/**
 * Generate the quotation PDF in a chosen currency.
 *
 * Amounts are stored in INR. `currency` and `rate` decide only how the buyer's
 * copy reads, and both are recorded on the quotation so a reprint reproduces the
 * document that was sent.
 *
 * The rate can be changed freely while the quotation is a DRAFT. Once it has been
 * marked SENT the buyer holds a copy at a stated price, so the recorded currency
 * and rate are reused and a request to change them is refused rather than quietly
 * producing a second, different document under the same number.
 */
router.get('/:id/pdf', can('SALES_VIEW'), async (req, res, next) => {
  try {
    const quotation = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: {
        buyer: { include: { country: true, contacts: { where: { isPrimary: true } } } },
        incoterm: true,
        portOfLoading: true,
        portOfDischarge: true,
        // The printed "Buyer Reference" is the inquiry this quotation answers.
        inquiry: { select: { inquiryNumber: true } },
        items: { include: { product: true } },
        costs: true,
      },
    });

    if (!quotation) throw new NotFoundError('Quotation');

    /**
     * Once a quotation has been issued to a buyer in a foreign currency, that
     * currency and rate are what they hold, so they are reused and a request to
     * change them is refused - revising the quotation is the way to re-price.
     *
     * Generating in INR does not lock anything: nothing has been committed in
     * foreign terms, and the base currency is the default. Treating a plain rupee
     * print as a commitment meant that generating one on an accepted quotation
     * permanently prevented issuing it in the buyer's currency.
     */
    const issuedInForeignCurrency =
      quotation.pdfCurrency !== null && quotation.pdfCurrency !== BASE_CURRENCY_CODE;
    const isFrozen = quotation.status !== 'DRAFT' && issuedInForeignCurrency;

    const requestedCode = (req.query.currency as string | undefined)?.toUpperCase();
    const requestedRate =
      req.query.rate !== undefined ? Number(req.query.rate) : undefined;

    if (isFrozen && requestedCode && requestedCode !== quotation.pdfCurrency) {
      throw new AppError(
        `${quotation.quotationNumber} was already issued in ${quotation.pdfCurrency} at ${Number(
          quotation.pdfExchangeRate
        )}. Revise the quotation to price it differently.`,
        400
      );
    }

    const code = isFrozen
      ? quotation.pdfCurrency!
      : (requestedCode ?? quotation.pdfCurrency ?? BASE_CURRENCY_CODE);
    const rate = isFrozen
      ? Number(quotation.pdfExchangeRate)
      : (requestedRate ??
        (quotation.pdfExchangeRate !== null ? Number(quotation.pdfExchangeRate) : 1));

    const currency = await resolveDocumentCurrency(code, rate);

    if (!isFrozen) {
      await prisma.quotation.update({
        where: { id: quotation.id },
        data: {
          pdfCurrency: currency.code,
          pdfExchangeRate: rate,
          pdfGeneratedAt: new Date(),
        },
      });
    }

    const companyProfile = await prisma.companyProfile.findFirst();

    const pdfBuffer = await generateQuotationPDF(quotation, {
      currencyCode: currency.code,
      currencySymbol: currency.symbol,
      rate,
      companyProfile,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${quotation.quotationNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

export { router as quotationRouter };
