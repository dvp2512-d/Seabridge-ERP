import { Router } from 'express';
import { z } from 'zod';
import { prisma, Prisma, InquiryStage } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode, calculateMarginPercent } from '../utils/helpers';
import { buildQuotationDocument } from '../services/exportDocuments';
import { buildRateMap } from '../services/exchangeRateService';
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
          currency: { select: { id: true, code: true, symbol: true } },
          incoterm: { select: { id: true, code: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.quotation.count({ where }),
      // Status counts for the whole filtered set so the summary cards are correct
      // even when the list is paginated. Grouped by currency too, since quotation
      // totals in different currencies cannot be added directly.
      prisma.quotation.groupBy({
        by: ['status', 'currencyId'],
        where,
        _count: { _all: true },
        _sum: { grandTotal: true },
      }),
    ]);

    // Fold the currency dimension away, converting into the base currency.
    const { base, rates } = await buildRateMap(new Date());

    const countByStatus: Record<string, number> = {};
    let totalValue = 0;
    let unconverted = 0;

    for (const group of statusGroups) {
      countByStatus[group.status] = (countByStatus[group.status] ?? 0) + group._count._all;

      const rate = rates.get(group.currencyId);
      if (rate === undefined) {
        unconverted += group._count._all;
        continue;
      }
      totalValue += Number(group._sum.grandTotal ?? 0) * rate;
    }

    res.json({
      success: true,
      data: quotations,
      pagination: { page: Number(page), limit: Number(limit), total },
      summary: {
        // totalValue is in this currency, not each quotation's own.
        baseCurrency: base,
        unconvertedRecords: unconverted,
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
        currency: true,
        incoterm: true,
        portOfLoading: { include: { country: true } },
        portOfDischarge: { include: { country: true } },
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
      currencyId: z.string().min(1),
      incotermId: z.string().min(1),
      validUntil: z.string().transform(s => new Date(s)),
      // Shipping details
      dispatchMethod: z.string().optional(),
      shipmentType: z.string().optional(),
      portOfLoadingId: z.string().optional(),
      portOfDischargeId: z.string().optional(),
      deliveryTerms: z.string().optional(),
      paymentTerms: z.string().optional(),
      notes: z.string().optional(),
      termsConditions: z.string().optional(),
      items: z.array(z.object({
        productId: z.string().min(1),
        quantity: z.number().finite().positive(),
        unit: z.string().optional(),
        unitCost: z.number().finite().min(0),
        unitPrice: z.number().finite().positive(),
        specifications: z.string().optional(),
      })).min(1),
      costs: z.array(z.object({
        costType: z.string().min(1),
        description: z.string().min(1),
        amount: z.number().finite().min(0),
        currency: z.string().optional(),
      })).optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const { items, costs, ...data } = validation.data;
    const quotationNumber = await generateCode('QUOTATION', 'QT');

    // Calculate totals
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

    // Additional costs (CHA, transport, insurance...) are recorded under total
    // cost and billed on to the buyer, but they do NOT earn margin. Margin comes
    // from the line items only, so adding a shipment cost never reduces it.
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
        currency: true,
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
      // Shipping details
      dispatchMethod: z.string().nullable().optional(),
      shipmentType: z.string().nullable().optional(),
      portOfLoadingId: z.string().nullable().optional(),
      portOfDischargeId: z.string().nullable().optional(),
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
      include: { buyer: true, currency: true, incoterm: true },
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
      include: { buyer: true, currency: true, incoterm: true },
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
        // Printed in the header of every export document
        dispatchMethod: z.string().optional(),
        shipmentType: z.string().optional(),
        portOfLoadingId: z.string().optional(),
        portOfDischargeId: z.string().optional(),
        variationPercent: z.number().min(0).max(100).optional(),
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
      dispatchMethod: validation.data.dispatchMethod,
      shipmentType: validation.data.shipmentType,
      portOfLoadingId: validation.data.portOfLoadingId,
      portOfDischargeId: validation.data.portOfDischargeId,
      variationPercent: validation.data.variationPercent,
      notes: validation.data.notes,
    });

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
});

// Generate PDF
router.get('/:id/pdf', can('SALES_VIEW'), async (req, res, next) => {
  try {
    const quotation = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: {
        buyer: { include: { country: true, contacts: { where: { isPrimary: true } } } },
        currency: true,
        incoterm: true,
        portOfLoading: { include: { country: true } },
        portOfDischarge: { include: { country: true } },
        items: { include: { product: true } },
        costs: true,
      },
    });

    if (!quotation) throw new NotFoundError('Quotation');

    const company = await prisma.companyProfile.findFirst();
    if (!company) {
      throw new AppError(
        'Company profile is not set up. Seed the database or add it in Settings before generating documents.',
        400
      );
    }

    // Rendered from the QUOTE FORMATE sheet of MASTER DRAFT.xlsx
    const pdfBuffer = await buildQuotationDocument(quotation, company);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${quotation.quotationNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

export { router as quotationRouter };
