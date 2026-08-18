import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';
import { cancelInquiry } from '../services/cancellationService';

const router: Router = Router();

router.use(authenticate);

// List inquiries
router.get('/', can('SALES_VIEW'), async (req, res, next) => {
  try {
    const { stage, buyerId, salesOwnerId, search, page = 1, limit = 50 } = req.query;

    const where: any = {};
    if (stage) where.stage = stage;
    if (buyerId) where.buyerId = buyerId;
    if (salesOwnerId) where.salesOwnerId = salesOwnerId;
    if (search) {
      where.OR = [
        { inquiryNumber: { contains: search as string, mode: 'insensitive' } },
        { buyer: { companyName: { contains: search as string, mode: 'insensitive' } } },
      ];
    }

    const [inquiries, total] = await Promise.all([
      prisma.inquiry.findMany({
        where,
        include: {
          buyer: { select: { id: true, companyName: true, code: true } },
          salesOwner: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { items: true, quotations: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.inquiry.count({ where }),
    ]);

    res.json({
      success: true,
      data: inquiries,
      pagination: { page: Number(page), limit: Number(limit), total },
    });
  } catch (error) {
    next(error);
  }
});

// Get inquiry detail
router.get('/:id', can('SALES_VIEW'), async (req, res, next) => {
  try {
    const inquiry = await prisma.inquiry.findUnique({
      where: { id: req.params.id },
      include: {
        buyer: { include: { country: true, contacts: { where: { isPrimary: true } } } },
        salesOwner: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        items: { include: { product: true } },
        quotations: { orderBy: { createdAt: 'desc' } },
        followUps: { orderBy: { scheduledAt: 'desc' } },
      },
    });

    if (!inquiry) throw new NotFoundError('Inquiry');
    res.json({ success: true, data: inquiry });
  } catch (error) {
    next(error);
  }
});

// Create inquiry
router.post('/', can('SALES_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      buyerId: z.string().min(1),
      salesOwnerId: z.string().optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
      source: z.string().optional(),
      expectedValue: z.number().optional(),
      expectedDate: z.string().transform(s => new Date(s)).optional(),
      requirements: z.string().optional(),
      notes: z.string().optional(),
      items: z.array(z.object({
        productId: z.string().min(1),
        quantity: z.number().positive(),
        unit: z.string().optional(),
        targetPrice: z.number().optional(),
        specifications: z.string().optional(),
      })).optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const { items, ...data } = validation.data;
    const inquiryNumber = await generateCode('INQUIRY', 'INQ');

    const inquiry = await prisma.inquiry.create({
      data: {
        ...data,
        inquiryNumber,
        salesOwnerId: data.salesOwnerId || req.user!.id,
        createdById: req.user!.id,
        items: items ? { create: items } : undefined,
      },
      include: {
        buyer: { select: { id: true, companyName: true } },
        items: { include: { product: true } },
      },
    });

    res.status(201).json({ success: true, data: inquiry });
  } catch (error) {
    next(error);
  }
});

// Update inquiry
router.put('/:id', can('SALES_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      stage: z.enum(['NEW', 'REQUIREMENT_GATHERED', 'PRICING_IN_PROGRESS', 'QUOTATION_SENT', 'NEGOTIATION', 'WON', 'LOST', 'ON_HOLD']).optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
      salesOwnerId: z.string().optional(),
      expectedValue: z.number().optional(),
      expectedDate: z.string().transform(s => new Date(s)).optional(),
      requirements: z.string().optional(),
      notes: z.string().optional(),
      lostReason: z.string().optional(),
      nextFollowUp: z.string().transform(s => new Date(s)).optional(),
      nextAction: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const updateData: any = { ...validation.data };
    if (validation.data.stage === 'WON' || validation.data.stage === 'LOST') {
      updateData.closedAt = new Date();
    }

    const inquiry = await prisma.inquiry.update({
      where: { id: req.params.id },
      data: updateData,
      include: { buyer: true, salesOwner: true },
    });

    res.json({ success: true, data: inquiry });
  } catch (error) {
    next(error);
  }
});

// Add inquiry item
router.post('/:id/items', can('SALES_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      productId: z.string().min(1),
      quantity: z.number().positive(),
      unit: z.string().optional(),
      targetPrice: z.number().optional(),
      specifications: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const item = await prisma.inquiryItem.create({
      data: { ...validation.data, inquiryId: req.params.id },
      include: { product: true },
    });

    res.status(201).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

// Add follow-up
router.post('/:id/followups', can('SALES_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      scheduledAt: z.string().transform(s => new Date(s)),
      type: z.string().min(1),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const followUp = await prisma.followUp.create({
      data: { ...validation.data, inquiryId: req.params.id },
    });

    // Update inquiry next follow-up
    await prisma.inquiry.update({
      where: { id: req.params.id },
      data: { nextFollowUp: validation.data.scheduledAt },
    });

    res.status(201).json({ success: true, data: followUp });
  } catch (error) {
    next(error);
  }
});

/** Mark an inquiry lost, which is the language the pipeline already uses. */
router.put('/:id/cancel', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const result = await cancelInquiry(req.params.id, req.body?.reason);
    res.json({ success: true, data: result, message: result.message });
  } catch (error) {
    next(error);
  }
});

export { router as inquiryRouter };
