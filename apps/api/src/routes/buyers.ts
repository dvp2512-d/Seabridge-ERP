import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';

const router: Router = Router();

router.use(authenticate);

// List buyers
router.get('/', can('BUYER_VIEW'), async (req, res, next) => {
  try {
    const { status, countryId, search, page = 1, limit = 50 } = req.query;

    const where: any = {};
    if (status) where.status = status;
    if (countryId) where.countryId = countryId;
    if (search) {
      where.OR = [
        { companyName: { contains: search as string, mode: 'insensitive' } },
        { code: { contains: search as string, mode: 'insensitive' } },
        { tradeName: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [buyers, total] = await Promise.all([
      prisma.buyer.findMany({
        where,
        include: {
          country: { select: { id: true, name: true, code: true } },
          currency: { select: { id: true, code: true, symbol: true } },
          _count: { select: { inquiries: true, orders: true, invoices: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.buyer.count({ where }),
    ]);

    res.json({
      success: true,
      data: buyers,
      pagination: { page: Number(page), limit: Number(limit), total },
    });
  } catch (error) {
    next(error);
  }
});

// Get buyer 360° view
router.get('/:id', can('BUYER_VIEW'), async (req, res, next) => {
  try {
    const buyer = await prisma.buyer.findUnique({
      where: { id: req.params.id },
      include: {
        country: true,
        currency: true,
        contacts: { where: { isActive: true }, orderBy: { isPrimary: 'desc' } },
        communications: { take: 10, orderBy: { createdAt: 'desc' }, include: { user: { select: { firstName: true, lastName: true } } } },
        inquiries: { take: 10, orderBy: { createdAt: 'desc' }, select: { id: true, inquiryNumber: true, stage: true, expectedValue: true, createdAt: true } },
        quotations: { take: 10, orderBy: { createdAt: 'desc' }, select: { id: true, quotationNumber: true, status: true, grandTotal: true, createdAt: true } },
        orders: { take: 10, orderBy: { createdAt: 'desc' }, select: { id: true, orderNumber: true, status: true, totalValue: true, createdAt: true } },
        invoices: { take: 10, orderBy: { createdAt: 'desc' }, select: { id: true, invoiceNumber: true, status: true, totalAmount: true, balanceAmount: true } },
      },
    });

    if (!buyer) throw new NotFoundError('Buyer');
    res.json({ success: true, data: buyer });
  } catch (error) {
    next(error);
  }
});

// Create buyer
router.post('/', can('BUYER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      companyName: z.string().min(1),
      tradeName: z.string().optional(),
      countryId: z.string().min(1),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
      website: z.string().optional(),
      industry: z.string().optional(),
      status: z.enum(['LEAD', 'PROSPECT', 'ACTIVE', 'INACTIVE', 'CHURNED']).optional(),
      source: z.string().optional(),
      currencyId: z.string().optional(),
      paymentTerms: z.string().optional(),
      creditLimit: z.number().optional(),
      creditDays: z.number().optional(),
      taxId: z.string().optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const code = await generateCode('BUYER', 'BYR');

    const buyer = await prisma.buyer.create({
      data: { ...validation.data, code },
      include: { country: true, currency: true },
    });

    res.status(201).json({ success: true, data: buyer });
  } catch (error) {
    next(error);
  }
});

// Update buyer
router.put('/:id', can('BUYER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      companyName: z.string().min(1).optional(),
      tradeName: z.string().optional(),
      countryId: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
      website: z.string().optional(),
      industry: z.string().optional(),
      status: z.enum(['LEAD', 'PROSPECT', 'ACTIVE', 'INACTIVE', 'CHURNED']).optional(),
      source: z.string().optional(),
      currencyId: z.string().optional(),
      paymentTerms: z.string().optional(),
      creditLimit: z.number().optional(),
      creditDays: z.number().optional(),
      taxId: z.string().optional(),
      notes: z.string().optional(),
      isActive: z.boolean().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const buyer = await prisma.buyer.update({
      where: { id: req.params.id },
      data: validation.data,
      include: { country: true, currency: true },
    });

    res.json({ success: true, data: buyer });
  } catch (error) {
    next(error);
  }
});

// Add contact
router.post('/:id/contacts', can('BUYER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      firstName: z.string().min(1),
      lastName: z.string().optional(),
      designation: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      mobile: z.string().optional(),
      isPrimary: z.boolean().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const contact = await prisma.buyerContact.create({
      data: { ...validation.data, buyerId: req.params.id },
    });

    res.status(201).json({ success: true, data: contact });
  } catch (error) {
    next(error);
  }
});

// Update a contact
router.put('/:id/contacts/:contactId', can('BUYER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      firstName: z.string().min(1).optional(),
      lastName: z.string().optional(),
      designation: z.string().optional(),
      email: z.string().email().optional().or(z.literal('')),
      phone: z.string().optional(),
      mobile: z.string().optional(),
      isPrimary: z.boolean().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.buyerContact.findFirst({
      where: { id: req.params.contactId, buyerId: req.params.id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Contact');

    const contact = await prisma.buyerContact.update({
      where: { id: req.params.contactId },
      data: validation.data,
    });

    res.json({ success: true, data: contact });
  } catch (error) {
    next(error);
  }
});

// Add communication
router.post('/:id/communications', can('BUYER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      type: z.string().min(1),
      subject: z.string().optional(),
      content: z.string().optional(),
      direction: z.enum(['INBOUND', 'OUTBOUND']).optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const communication = await prisma.communication.create({
      data: { ...validation.data, buyerId: req.params.id, userId: req.user!.id },
    });

    res.status(201).json({ success: true, data: communication });
  } catch (error) {
    next(error);
  }
});

// Delete buyer
router.delete('/:id', can('BUYER_MANAGE'), async (req, res, next) => {
  try {
    await prisma.buyer.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ success: true, message: 'Buyer deactivated' });
  } catch (error) {
    next(error);
  }
});

export { router as buyerRouter };
