import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';

const router: Router = Router();

router.use(authenticate);

// List products
router.get('/', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const { categoryId, search, isActive } = req.query;

    const where: any = {};
    if (categoryId) where.categoryId = categoryId;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { code: { contains: search as string, mode: 'insensitive' } },
        { hsnCode: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const products = await prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: products });
  } catch (error) {
    next(error);
  }
});

// Get product
router.get('/:id', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        category: true,
        supplierPrices: {
          where: { isActive: true },
          include: { supplier: { select: { id: true, name: true, code: true } } },
          orderBy: { price: 'asc' },
        },
      },
    });

    if (!product) throw new NotFoundError('Product');
    res.json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
});

// Create product
router.post('/', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      categoryId: z.string().min(1),
      hsnCode: z.string().optional(),
      unit: z.string().optional(),
      // Default packaging, used to prefill order lines and the Packing List
      packageType: z.string().optional(),
      packageNetWeight: z.number().positive().optional(),
      packageGrossWeight: z.number().positive().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const code = await generateCode('PRODUCT', 'PRD');

    const product = await prisma.product.create({
      data: { ...validation.data, code },
      include: { category: true },
    });

    res.status(201).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
});

// Update product
router.put('/:id', can('MASTER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      categoryId: z.string().optional(),
      hsnCode: z.string().optional(),
      unit: z.string().optional(),
      // Default packaging, used to prefill order lines and the Packing List
      packageType: z.string().optional(),
      packageNetWeight: z.number().positive().nullable().optional(),
      packageGrossWeight: z.number().positive().nullable().optional(),
      isActive: z.boolean().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: validation.data,
      include: { category: true },
    });

    res.json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
});

// Product categories
router.get('/categories/list', can('MASTER_VIEW'), async (req, res, next) => {
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

router.post('/categories', can('MASTER_MANAGE'), async (req, res, next) => {
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

export { router as productRouter };
