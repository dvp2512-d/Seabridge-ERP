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
      // GST percent for domestic purchases, which prefills purchase order lines.
      gstRate: z.number().min(0).max(100).optional(),
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
      gstRate: z.number().min(0).max(100).nullable().optional(),
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

// NOTE: Product categories are managed via /api/master/product-categories.
// The routes that used to live here were duplicates and have been removed.

/**
 * Get the latest/best supplier price for a product.
 * Used to auto-fill unit cost when adding items to quotations.
 * Returns the cheapest active price from any supplier, or a specific supplier's price.
 */
router.get('/:id/latest-price', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const { supplierId } = req.query;
    const now = new Date();

    const where: any = {
      productId: req.params.id,
      isActive: true,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
    };

    // If specific supplier requested, filter to that supplier
    if (supplierId) {
      where.supplierId = supplierId as string;
    }

    // Get all valid prices, ordered by price (cheapest first) and date (newest first)
    const prices = await prisma.supplierPrice.findMany({
      where,
      include: { 
        supplier: { select: { id: true, name: true, code: true } },
        product: { select: { id: true, name: true, code: true, unit: true } },
      },
      orderBy: [{ price: 'asc' }, { validFrom: 'desc' }],
      take: 5, // Return top 5 options
    });

    if (prices.length === 0) {
      return res.json({
        success: true,
        data: null,
        message: 'No active supplier prices found for this product',
      });
    }

    // Best price is the first (cheapest and most recent)
    const bestPrice = prices[0];

    res.json({
      success: true,
      data: {
        bestPrice: {
          supplierId: bestPrice.supplierId,
          supplierName: bestPrice.supplier.name,
          price: Number(bestPrice.price),
          currency: bestPrice.currency,
          unit: bestPrice.unit,
          minQuantity: bestPrice.minQuantity ? Number(bestPrice.minQuantity) : null,
          validFrom: bestPrice.validFrom,
          validTo: bestPrice.validTo,
        },
        // All available prices for comparison
        allPrices: prices.map(p => ({
          supplierId: p.supplierId,
          supplierName: p.supplier.name,
          supplierCode: p.supplier.code,
          price: Number(p.price),
          currency: p.currency,
          unit: p.unit,
          minQuantity: p.minQuantity ? Number(p.minQuantity) : null,
          validFrom: p.validFrom,
          validTo: p.validTo,
        })),
        product: bestPrice.product,
      },
    });
  } catch (error) {
    next(error);
  }
});

export { router as productRouter };
