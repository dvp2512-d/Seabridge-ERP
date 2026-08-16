import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';

const router: Router = Router();

router.use(authenticate);

// List suppliers
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

    const suppliers = await prisma.supplier.findMany({
      where,
      include: { country: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: suppliers });
  } catch (error) {
    next(error);
  }
});

// Get supplier with prices
router.get('/:id', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        country: true,
        supplierPrices: {
          where: { isActive: true },
          include: { product: { select: { id: true, name: true, code: true, unit: true } } },
          orderBy: { validFrom: 'desc' },
        },
      },
    });

    if (!supplier) throw new NotFoundError('Supplier');
    res.json({ success: true, data: supplier });
  } catch (error) {
    next(error);
  }
});

// Create supplier
router.post('/', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      contactPerson: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      countryId: z.string().optional(),
      gstNumber: z.string().optional(),
      panNumber: z.string().optional(),
      bankDetails: z.string().optional(),
      paymentTerms: z.string().optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const code = await generateCode('SUPPLIER', 'SUP');

    const supplier = await prisma.supplier.create({
      data: { ...validation.data, code },
      include: { country: true },
    });

    res.status(201).json({ success: true, data: supplier });
  } catch (error) {
    next(error);
  }
});

// Update supplier
router.put('/:id', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      contactPerson: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      countryId: z.string().optional(),
      gstNumber: z.string().optional(),
      panNumber: z.string().optional(),
      bankDetails: z.string().optional(),
      paymentTerms: z.string().optional(),
      rating: z.number().min(0).max(5).optional(),
      notes: z.string().optional(),
      isActive: z.boolean().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const supplier = await prisma.supplier.update({
      where: { id: req.params.id },
      data: validation.data,
    });

    res.json({ success: true, data: supplier });
  } catch (error) {
    next(error);
  }
});

// Add supplier price
router.post('/:id/prices', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      productId: z.string().min(1),
      price: z.number().positive(),
      currency: z.string().optional(),
      unit: z.string().optional(),
      minQuantity: z.number().optional(),
      validFrom: z.string().transform(s => new Date(s)),
      validTo: z.string().transform(s => new Date(s)).optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const price = await prisma.supplierPrice.create({
      data: { ...validation.data, supplierId: req.params.id },
      include: { product: true },
    });

    res.status(201).json({ success: true, data: price });
  } catch (error) {
    next(error);
  }
});

export { router as supplierRouter };
