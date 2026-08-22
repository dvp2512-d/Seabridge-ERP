import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';
import { createOrderFromQuotation } from '../services/orderService';

const router: Router = Router();

router.use(authenticate);

// List orders
router.get('/', can('OPERATIONS_VIEW'), async (req, res, next) => {
  try {
    const { status, buyerId, search, page = 1, limit = 50 } = req.query;

    const where: any = {};
    if (status) where.status = status;
    if (buyerId) where.buyerId = buyerId;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search as string, mode: 'insensitive' } },
        { buyer: { companyName: { contains: search as string, mode: 'insensitive' } } },
      ];
    }

    const [orders, total, statusGroups, valueTotals, overdueCount] = await Promise.all([
      prisma.exportOrder.findMany({
        where,
        include: {
          buyer: { select: { id: true, companyName: true, code: true } },
          incoterm: { select: { id: true, code: true } },
          _count: { select: { items: true, shipments: true, invoices: true, documents: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.exportOrder.count({ where }),
      // Pipeline counts across the whole filtered set, not just this page.
      prisma.exportOrder.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { totalValue: true },
      }),
      prisma.exportOrder.aggregate({ where, _sum: { totalValue: true } }),
      prisma.exportOrder.count({
        where: {
          ...where,
          status: { notIn: ['DELIVERED', 'CANCELLED'] },
          expectedDate: { lt: new Date() },
        },
      }),
    ]);

    const countByStatus: Record<string, number> = {};
    for (const group of statusGroups) {
      countByStatus[group.status] = group._count._all;
    }

    res.json({
      success: true,
      data: orders,
      pagination: { page: Number(page), limit: Number(limit), total },
      summary: {
        countByStatus,
        overdueCount,
        totalValue: Number(valueTotals._sum.totalValue ?? 0),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get order detail
router.get('/:id', can('OPERATIONS_VIEW'), async (req, res, next) => {
  try {
    const order = await prisma.exportOrder.findUnique({
      where: { id: req.params.id },
      include: {
        buyer: { include: { country: true } },
        quotation: { select: { id: true, quotationNumber: true } },
        incoterm: true,
        items: { include: { product: true } },
        procurements: { include: { supplier: true } },
        documents: { orderBy: { documentType: 'asc' } },
        shipments: { include: { cha: true, transporter: true, originPort: true, destinationPort: true } },
        invoices: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!order) throw new NotFoundError('Order');
    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
});

// Create order from quotation
router.post('/', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      quotationId: z.string().min(1),
      orderDate: z.string().optional(),
      expectedDate: z.string().optional(),
      poNumber: z.string().optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const order = await createOrderFromQuotation(validation.data.quotationId, {
      orderDate: validation.data.orderDate ? new Date(validation.data.orderDate) : undefined,
      expectedDate: validation.data.expectedDate
        ? new Date(validation.data.expectedDate)
        : undefined,
      poNumber: validation.data.poNumber,
      notes: validation.data.notes,
    });

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
});

// Update order status
router.put('/:id', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'CANCELLED']).optional(),
      expectedDate: z.string().transform(s => new Date(s)).optional(),
      poNumber: z.string().optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.exportOrder.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Order');

    const order = await prisma.exportOrder.update({
      where: { id: req.params.id },
      data: validation.data,
      include: {
        buyer: { select: { id: true, companyName: true, code: true } },
        incoterm: true,
      },
    });

    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
});

// Add procurement
router.post('/:id/procurements', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      supplierId: z.string().min(1),
      totalAmount: z.number().positive(),
      currency: z.string().optional(),
      expectedDate: z.string().transform(s => new Date(s)).optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const poNumber = await generateCode('PROCUREMENT', 'PO');

    const procurement = await prisma.procurement.create({
      data: {
        ...validation.data,
        orderId: req.params.id,
        poNumber,
        orderDate: new Date(),
      },
      include: { supplier: true },
    });

    res.status(201).json({ success: true, data: procurement });
  } catch (error) {
    next(error);
  }
});

// Add shipment
router.post('/:id/shipments', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      chaId: z.string().optional(),
      transporterId: z.string().optional(),
      originPortId: z.string().optional(),
      destinationPortId: z.string().optional(),
      containerNumber: z.string().optional(),
      containerType: z.string().optional(),
      etd: z.string().transform(s => new Date(s)).optional(),
      eta: z.string().transform(s => new Date(s)).optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const shipmentNumber = await generateCode('SHIPMENT', 'SHP');

    const shipment = await prisma.shipment.create({
      data: {
        ...validation.data,
        orderId: req.params.id,
        shipmentNumber,
      },
      include: { cha: true, transporter: true, originPort: true, destinationPort: true },
    });

    res.status(201).json({ success: true, data: shipment });
  } catch (error) {
    next(error);
  }
});

// Update document status
router.put('/:orderId/documents/:docId', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']),
      documentNo: z.string().optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const updateData: any = { ...validation.data };
    if (validation.data.status === 'COMPLETED') {
      updateData.completedAt = new Date();
    }

    const document = await prisma.document.update({
      where: { id: req.params.docId },
      data: updateData,
    });

    res.json({ success: true, data: document });
  } catch (error) {
    next(error);
  }
});

export { router as orderRouter };
