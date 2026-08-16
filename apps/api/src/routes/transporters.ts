import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';

const router: Router = Router();

router.use(authenticate);

// List transporters
router.get('/', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const { serviceType, search, isActive } = req.query;

    const where: any = {};
    if (serviceType) where.serviceType = serviceType;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { code: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const transporters = await prisma.transporter.findMany({
      where,
      // Rates are included so quotations can offer them as selectable values.
      include: { transportRates: { where: { isActive: true }, orderBy: { origin: 'asc' } } },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: transporters });
  } catch (error) {
    next(error);
  }
});

// Get transporter with rates
router.get('/:id', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const transporter = await prisma.transporter.findUnique({
      where: { id: req.params.id },
      include: {
        transportRates: { where: { isActive: true }, orderBy: { origin: 'asc' } },
      },
    });

    if (!transporter) throw new NotFoundError('Transporter');
    res.json({ success: true, data: transporter });
  } catch (error) {
    next(error);
  }
});

// Create transporter
router.post('/', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      contactPerson: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      serviceType: z.enum(['ROAD', 'RAIL', 'SEA', 'AIR']).optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const code = await generateCode('TRANSPORTER', 'TRN');

    const transporter = await prisma.transporter.create({
      data: { ...validation.data, code },
    });

    res.status(201).json({ success: true, data: transporter });
  } catch (error) {
    next(error);
  }
});

// Update transporter
router.put('/:id', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      contactPerson: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      serviceType: z.enum(['ROAD', 'RAIL', 'SEA', 'AIR']).optional(),
      rating: z.number().min(0).max(5).optional(),
      notes: z.string().optional(),
      isActive: z.boolean().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const transporter = await prisma.transporter.update({
      where: { id: req.params.id },
      data: validation.data,
    });

    res.json({ success: true, data: transporter });
  } catch (error) {
    next(error);
  }
});

// Add transport rate
router.post('/:id/rates', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      origin: z.string().min(1),
      destination: z.string().min(1),
      rate: z.number().positive(),
      currency: z.string().optional(),
      containerType: z.string().optional(),
      transitDays: z.number().optional(),
      validFrom: z.string().transform(s => new Date(s)),
      validTo: z.string().transform(s => new Date(s)).optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const rate = await prisma.transportRate.create({
      data: { ...validation.data, transporterId: req.params.id },
    });

    res.status(201).json({ success: true, data: rate });
  } catch (error) {
    next(error);
  }
});

export { router as transporterRouter };
