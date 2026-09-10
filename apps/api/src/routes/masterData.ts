import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';

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

/**
 * A currency's exchangeRate is how many units of the BASE currency (INR) one
 * unit of it is worth. Conversions multiply by this column, so a wrong value
 * here silently misstates every converted total in the application.
 *
 * Two protections:
 *  - z.coerce.number() accepts the Decimal-as-string the API itself returns, so
 *    round-tripping a row back through the form cannot fail on a type.
 *  - exactly 1 is rejected for anything but the base currency. 1 is the column
 *    default, so "never set" and "set to 1" are indistinguishable, and a rate of
 *    1 claims the currency is at parity with the rupee.
 */
const BASE_CURRENCY_CODE = 'INR';

function assertSensibleRate(rate: number | undefined, code: string) {
  if (rate === undefined) return;
  if (code.toUpperCase() === BASE_CURRENCY_CODE) return;
  if (rate === 1) {
    throw new AppError(
      `A rate of 1 would mean 1 ${code.toUpperCase()} = 1 ${BASE_CURRENCY_CODE}. ` +
        `Enter how many ${BASE_CURRENCY_CODE} one ${code.toUpperCase()} is worth.`,
      400
    );
  }
}

router.post('/currencies', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      code: z.string().length(3),
      name: z.string().min(1),
      symbol: z.string().min(1),
      exchangeRate: z.coerce.number().positive().optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    assertSensibleRate(validation.data.exchangeRate, validation.data.code);

    const currency = await prisma.currency.create({ data: validation.data });
    res.status(201).json({ success: true, data: currency });
  } catch (error) {
    next(error);
  }
});

router.put('/currencies/:id', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      exchangeRate: z.coerce.number().positive().optional(),
      isActive: z.boolean().optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.currency.findUnique({
      where: { id: req.params.id },
      select: { code: true },
    });
    if (!existing) throw new NotFoundError('Currency');

    assertSensibleRate(validation.data.exchangeRate, existing.code);

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

router.get('/dropdowns', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const [countries, currencies, incoterms, categories, users, ports] = await Promise.all([
      prisma.country.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
      prisma.currency.findMany({ where: { isActive: true }, select: { id: true, code: true, symbol: true }, orderBy: { code: 'asc' } }),
      prisma.incoterm.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
      prisma.productCategory.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, firstName: true, lastName: true, role: true }, orderBy: { firstName: 'asc' } }),
      prisma.port.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true, type: true, country: { select: { name: true } } }, orderBy: { name: 'asc' } }),
    ]);

    res.json({
      success: true,
      data: {
        countries,
        currencies,
        incoterms,
        productCategories: categories,
        users,
        ports,
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
