import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';

const router: Router = Router();

router.use(authenticate);

/**
 * Shared list controls for the master data tables.
 *
 * Pagination is deliberately opt-in: it applies only when the caller passes `page`
 * or `limit`. Several dropdowns read these same endpoints expecting the complete
 * list - the currency picker in the document dialog, the port picker on a shipment,
 * the country picker in the port form - so a default page size would silently
 * truncate them and hide options the user needs.
 *
 * `includeInactive` exists because these tables now hold worldwide reference data.
 * An exporter will deactivate the countries and ports they never touch, and if the
 * list only ever returned active rows those would vanish with no way to restore
 * them, even though the screen shows a Status column.
 */
function listControls(req: { query: Record<string, any> }) {
  const rawSearch = req.query.search;
  const search = typeof rawSearch === 'string' ? rawSearch.trim() : '';

  const paginated = req.query.page !== undefined || req.query.limit !== undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  // Capped so a caller cannot ask for an unbounded page.
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 25));

  const includeInactive =
    req.query.includeInactive === 'true' || req.query.includeInactive === '1';

  return {
    search,
    paginated,
    page,
    limit,
    skip: (page - 1) * limit,
    activeFilter: includeInactive ? {} : { isActive: true },
  };
}

/** Case-insensitive "contains" across the given fields. */
function searchFilter(search: string, fields: string[]) {
  if (!search) return {};
  return {
    OR: fields.map((f) =>
      f.includes('.')
        ? {
            [f.split('.')[0]]: {
              [f.split('.')[1]]: { contains: search, mode: 'insensitive' as const },
            },
          }
        : { [f]: { contains: search, mode: 'insensitive' as const } }
    ),
  };
}

/** Only advertises `pagination` when the caller actually paginated. */
function listResponse(data: unknown[], total: number, c: ReturnType<typeof listControls>) {
  return c.paginated
    ? { success: true, data, pagination: { page: c.page, limit: c.limit, total } }
    : { success: true, data, total };
}

// ============================================
// COUNTRIES
// ============================================

router.get('/countries', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const c = listControls(req);
    const where = { ...c.activeFilter, ...searchFilter(c.search, ['code', 'name', 'region']) };
    const [countries, total] = await Promise.all([
      prisma.country.findMany({
        where,
        orderBy: { name: 'asc' },
        ...(c.paginated ? { skip: c.skip, take: c.limit } : {}),
      }),
      prisma.country.count({ where }),
    ]);
    res.json(listResponse(countries, total, c));
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
    const c = listControls(req);
    const { countryId, type } = req.query;
    const where: any = {
      ...c.activeFilter,
      ...searchFilter(c.search, ['code', 'name', 'country.name']),
    };
    if (countryId) where.countryId = countryId;
    if (type) where.type = type;

    const [ports, total] = await Promise.all([
      prisma.port.findMany({
        where,
        include: { country: { select: { name: true, code: true } } },
        orderBy: [{ code: 'asc' }],
        ...(c.paginated ? { skip: c.skip, take: c.limit } : {}),
      }),
      prisma.port.count({ where }),
    ]);
    res.json(listResponse(ports, total, c));
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
    const c = listControls(req);
    const where = { ...c.activeFilter, ...searchFilter(c.search, ['code', 'name']) };
    const [currencies, total] = await Promise.all([
      prisma.currency.findMany({
        where,
        orderBy: { code: 'asc' },
        ...(c.paginated ? { skip: c.skip, take: c.limit } : {}),
      }),
      prisma.currency.count({ where }),
    ]);
    res.json(listResponse(currencies, total, c));
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
    const c = listControls(req);
    const where = { ...c.activeFilter, ...searchFilter(c.search, ['code', 'name']) };
    const [incoterms, total] = await Promise.all([
      prisma.incoterm.findMany({
        where,
        orderBy: { code: 'asc' },
        ...(c.paginated ? { skip: c.skip, take: c.limit } : {}),
      }),
      prisma.incoterm.count({ where }),
    ]);
    res.json(listResponse(incoterms, total, c));
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
    const c = listControls(req);
    const where = { ...c.activeFilter, ...searchFilter(c.search, ['name', 'description']) };
    const [categories, total] = await Promise.all([
      prisma.productCategory.findMany({
        where,
        orderBy: { name: 'asc' },
        ...(c.paginated ? { skip: c.skip, take: c.limit } : {}),
      }),
      prisma.productCategory.count({ where }),
    ]);
    res.json(listResponse(categories, total, c));
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
