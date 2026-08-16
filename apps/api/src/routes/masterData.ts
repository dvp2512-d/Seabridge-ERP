import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../middleware/errorHandler';

const router: Router = Router();

router.use(authenticate);

// ============================================
// COUNTRIES
// ============================================

router.get('/countries', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const countries = await prisma.country.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: countries });
  } catch (error) {
    next(error);
  }
});

router.post('/countries', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      code: z.string().length(2),
      name: z.string().min(1),
      region: z.string().optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const country = await prisma.country.create({ data: validation.data });
    res.status(201).json({ success: true, data: country });
  } catch (error) {
    next(error);
  }
});

router.put('/countries/:id', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      code: z.string().length(2).optional(),
      name: z.string().min(1).optional(),
      region: z.string().optional(),
      isActive: z.boolean().optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const country = await prisma.country.update({
      where: { id: req.params.id },
      data: validation.data,
    });
    res.json({ success: true, data: country });
  } catch (error) {
    next(error);
  }
});

// ============================================
// PORTS
// ============================================

router.get('/ports', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const { countryId, type } = req.query;
    const where: any = { isActive: true };
    if (countryId) where.countryId = countryId;
    if (type) where.type = type;

    const ports = await prisma.port.findMany({
      where,
      include: { country: { select: { name: true, code: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: ports });
  } catch (error) {
    next(error);
  }
});

router.post('/ports', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      countryId: z.string().min(1),
      type: z.enum(['SEA', 'AIR', 'LAND']).optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const port = await prisma.port.create({ data: validation.data });
    res.status(201).json({ success: true, data: port });
  } catch (error) {
    next(error);
  }
});

router.put('/ports/:id', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      code: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      countryId: z.string().min(1).optional(),
      type: z.enum(['SEA', 'AIR', 'LAND']).optional(),
      isActive: z.boolean().optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const port = await prisma.port.update({
      where: { id: req.params.id },
      data: validation.data,
      include: { country: { select: { name: true, code: true } } },
    });
    res.json({ success: true, data: port });
  } catch (error) {
    next(error);
  }
});

// ============================================
// CURRENCIES
// ============================================

router.get('/currencies', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const currencies = await prisma.currency.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    res.json({ success: true, data: currencies });
  } catch (error) {
    next(error);
  }
});

router.post('/currencies', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      code: z.string().length(3),
      name: z.string().min(1),
      symbol: z.string().min(1),
      exchangeRate: z.number().positive().optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const currency = await prisma.currency.create({ data: validation.data });
    res.status(201).json({ success: true, data: currency });
  } catch (error) {
    next(error);
  }
});

router.put('/currencies/:id', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      exchangeRate: z.number().positive(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const currency = await prisma.currency.update({
      where: { id: req.params.id },
      data: validation.data,
    });
    res.json({ success: true, data: currency });
  } catch (error) {
    next(error);
  }
});

// ============================================
// INCOTERMS
// ============================================

router.get('/incoterms', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const incoterms = await prisma.incoterm.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    res.json({ success: true, data: incoterms });
  } catch (error) {
    next(error);
  }
});

router.post('/incoterms', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const incoterm = await prisma.incoterm.create({ data: validation.data });
    res.status(201).json({ success: true, data: incoterm });
  } catch (error) {
    next(error);
  }
});

router.put('/incoterms/:id', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      code: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const incoterm = await prisma.incoterm.update({
      where: { id: req.params.id },
      data: validation.data,
    });
    res.json({ success: true, data: incoterm });
  } catch (error) {
    next(error);
  }
});

// ============================================
// PRODUCT CATEGORIES
// ============================================

router.get('/product-categories', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const categories = await prisma.productCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: categories });
  } catch (error) {
    next(error);
  }
});

router.post('/product-categories', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const category = await prisma.productCategory.create({ data: validation.data });
    res.status(201).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
});

router.put('/product-categories/:id', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const category = await prisma.productCategory.update({
      where: { id: req.params.id },
      data: validation.data,
    });
    res.json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
});

// ============================================
// DROPDOWN OPTIONS (for forms)
// ============================================

// ============================================
// PRICING PARAMETERS
// ============================================
// The components that build up a quotation line price. Editing these never
// changes quotations that already exist - each line item keeps its own snapshot.

router.get('/pricing-parameters', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const { includeInactive } = req.query;
    const where = includeInactive === 'true' ? {} : { isActive: true };

    const parameters = await prisma.pricingParameter.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: parameters });
  } catch (error) {
    next(error);
  }
});

router.post('/pricing-parameters', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      sortOrder: z.number().int().optional(),
      calcType: z.enum(['FIXED', 'PER_UNIT', 'PERCENT_OF_COST', 'PERCENT_OF_PRODUCT']),
      defaultValue: z.number().finite().optional().nullable(),
      isMargin: z.boolean().optional(),
      isProductPrice: z.boolean().optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    // Append to the end unless an explicit position was given.
    let sortOrder = validation.data.sortOrder;
    if (sortOrder === undefined) {
      const last = await prisma.pricingParameter.findFirst({
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      sortOrder = (last?.sortOrder ?? 0) + 1;
    }

    const parameter = await prisma.pricingParameter.create({
      data: { ...validation.data, sortOrder },
    });
    res.status(201).json({ success: true, data: parameter });
  } catch (error) {
    next(error);
  }
});

router.put('/pricing-parameters/:id', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      sortOrder: z.number().int().optional(),
      calcType: z.enum(['FIXED', 'PER_UNIT', 'PERCENT_OF_COST', 'PERCENT_OF_PRODUCT']).optional(),
      defaultValue: z.number().finite().optional().nullable(),
      isMargin: z.boolean().optional(),
      isProductPrice: z.boolean().optional(),
      isActive: z.boolean().optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.pricingParameter.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Pricing parameter');

    const parameter = await prisma.pricingParameter.update({
      where: { id: req.params.id },
      data: validation.data,
    });
    res.json({ success: true, data: parameter });
  } catch (error) {
    next(error);
  }
});

router.delete('/pricing-parameters/:id', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const existing = await prisma.pricingParameter.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Pricing parameter');

    // Hard delete is safe: quotation line items store their own copy of the
    // component, so removing the master row cannot alter past quotations.
    await prisma.pricingParameter.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Pricing parameter deleted' });
  } catch (error) {
    next(error);
  }
});

router.get('/dropdowns', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const [countries, currencies, incoterms, categories, users] = await Promise.all([
      prisma.country.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
      prisma.currency.findMany({ where: { isActive: true }, select: { id: true, code: true, symbol: true }, orderBy: { code: 'asc' } }),
      prisma.incoterm.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
      prisma.productCategory.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, firstName: true, lastName: true, role: true }, orderBy: { firstName: 'asc' } }),
    ]);

    res.json({
      success: true,
      data: {
        countries,
        currencies,
        incoterms,
        productCategories: categories,
        users,
        buyerStatuses: ['LEAD', 'PROSPECT', 'ACTIVE', 'INACTIVE', 'CHURNED'],
        inquiryStages: ['NEW', 'REQUIREMENT_GATHERED', 'PRICING_IN_PROGRESS', 'QUOTATION_SENT', 'NEGOTIATION', 'WON', 'LOST', 'ON_HOLD'],
        inquiryPriorities: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
        quotationStatuses: ['DRAFT', 'SENT', 'REVISED', 'ACCEPTED', 'REJECTED', 'EXPIRED'],
        orderStatuses: ['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
        invoiceStatuses: ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'],
        containerTypes: ['20FT', '40FT', '40HC', 'LCL'],
        paymentModes: ['WIRE', 'LC', 'TT', 'CHEQUE', 'CASH'],
        communicationTypes: ['EMAIL', 'CALL', 'MEETING', 'WHATSAPP', 'VISIT'],
        units: ['KG', 'MT', 'LBS', 'PCS', 'CTN', 'BAGS', 'DRUMS'],
      },
    });
  } catch (error) {
    next(error);
  }
});

export { router as masterDataRouter };
