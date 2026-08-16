import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';

const router: Router = Router();

router.use(authenticate);

// List CHAs
router.get('/', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const { search, isActive } = req.query;

    const where: any = {};
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { code: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const chas = await prisma.cHA.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: chas });
  } catch (error) {
    next(error);
  }
});

// Get CHA with rates
router.get('/:id', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const cha = await prisma.cHA.findUnique({
      where: { id: req.params.id },
      include: {
        chaRates: { where: { isActive: true }, orderBy: { serviceType: 'asc' } },
      },
    });

    if (!cha) throw new NotFoundError('CHA');
    res.json({ success: true, data: cha });
  } catch (error) {
    next(error);
  }
});

// Create CHA
router.post('/', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      contactPerson: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      licenseNumber: z.string().optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const code = await generateCode('CHA', 'CHA');

    const cha = await prisma.cHA.create({
      data: { ...validation.data, code },
    });

    res.status(201).json({ success: true, data: cha });
  } catch (error) {
    next(error);
  }
});

// Update CHA
router.put('/:id', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      contactPerson: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      licenseNumber: z.string().optional(),
      rating: z.number().min(0).max(5).optional(),
      notes: z.string().optional(),
      isActive: z.boolean().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const cha = await prisma.cHA.update({
      where: { id: req.params.id },
      data: validation.data,
    });

    res.json({ success: true, data: cha });
  } catch (error) {
    next(error);
  }
});

// Add CHA rate
router.post('/:id/rates', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      serviceType: z.string().min(1),
      rate: z.number().positive(),
      currency: z.string().optional(),
      containerType: z.string().optional(),
      validFrom: z.string().transform(s => new Date(s)),
      validTo: z.string().transform(s => new Date(s)).optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const rate = await prisma.cHARate.create({
      data: { ...validation.data, chaId: req.params.id },
    });

    res.status(201).json({ success: true, data: rate });
  } catch (error) {
    next(error);
  }
});

export { router as chaRouter };
