import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';
import { cancelOrder } from '../services/cancellationService';
import { createOrderFromQuotation } from '../services/orderService';
import { buildPackingListDocument } from '../services/exportDocuments';
import { buildRateMapByCode } from '../services/exchangeRateService';
import { emitEvent } from '../services/eventService';

const router: Router = Router();

router.use(authenticate);

// List orders
router.get('/', can('OPERATIONS_VIEW'), async (req, res, next) => {
  try {
    const { status, buyerId, search, page = 1, limit = 50 } = req.query;

    const where: any = {};
    // A deleted record is marked cancelled rather than removed, so it keeps its
    // number for customs and the audit trail. Hidden from the default list so
    // deleting behaves as the user expects, but still reachable by filtering
    // explicitly on the cancelled status.
    if (status) where.status = status;
    else where.status = { not: 'CANCELLED' };
    if (buyerId) where.buyerId = buyerId;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search as string, mode: 'insensitive' } },
        { buyer: { companyName: { contains: search as string, mode: 'insensitive' } } },
      ];
    }

    const [orders, total, statusGroups, overdueCount] = await Promise.all([
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
      // Grouped by currency as well, because order values in different
      // currencies cannot be added - they are converted before totalling.
      prisma.exportOrder.groupBy({
        by: ['status', 'currency'],
        where,
        _count: { _all: true },
        _sum: { totalValue: true },
      }),
      prisma.exportOrder.count({
        where: {
          ...where,
          status: { notIn: ['DELIVERED', 'CANCELLED'] },
          expectedDate: { lt: new Date() },
        },
      }),
    ]);

    // Fold the currency dimension away, converting into the base currency.
    // Orders whose currency has no notified rate are counted rather than added,
    // so the total is never quietly incomplete.
    const { base, rates } = await buildRateMapByCode(new Date());

    const countByStatus: Record<string, number> = {};
    let totalValue = 0;
    let unconverted = 0;

    for (const group of statusGroups) {
      countByStatus[group.status] = (countByStatus[group.status] ?? 0) + group._count._all;

      const rate = rates.get(group.currency);
      if (rate === undefined) {
        unconverted += group._count._all;
        continue;
      }
      totalValue += Number(group._sum.totalValue ?? 0) * rate;
    }

    res.json({
      success: true,
      data: orders,
      pagination: { page: Number(page), limit: Number(limit), total },
      summary: {
        // totalValue is in this currency, not each order's own.
        baseCurrency: base,
        unconvertedRecords: unconverted,
        countByStatus,
        overdueCount,
        totalValue: Math.round((totalValue + Number.EPSILON) * 100) / 100,
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
        portOfLoading: { include: { country: true } },
        portOfDischarge: { include: { country: true } },
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
      // Printed in the header of every export document
      dispatchMethod: z.string().optional(),
      shipmentType: z.string().optional(),
      variationPercent: z.number().min(0).max(100).optional(),      notes: z.string().optional(),
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

    emitEvent('order.created', order);
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
      // Printed in the header of every export document
      dispatchMethod: z.string().optional(),
      shipmentType: z.string().optional(),
      variationPercent: z.number().min(0).max(100).optional(),      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.exportOrder.findUnique({
      where: { id: req.params.id },
      // Previous status is needed so the change event only fires on a real change
      select: { id: true, status: true },
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

    // Only when the status actually moved, so an unrelated edit does not look
    // like a status change to whoever is listening.
    if (validation.data.status && validation.data.status !== existing.status) {
      emitEvent('order.status_changed', {
        ...order,
        previousStatus: existing.status,
      });
    }

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

    emitEvent('shipment.created', shipment);
    res.status(201).json({ success: true, data: shipment });
  } catch (error) {
    next(error);
  }
});

/**
 * Update a shipment.
 *
 * Without this a shipment could only ever be created, so nothing could move past
 * PENDING - which also meant the order cancellation guard that checks shipment
 * status could never trigger, and shipment.status_changed could never fire.
 *
 * Departure and arrival are stamped automatically when the status reaches the
 * matching stage, so the dates cannot silently disagree with the status.
 */
router.put('/:id/shipments/:shipmentId', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['PENDING', 'BOOKED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED']).optional(),
      chaId: z.string().nullable().optional(),
      transporterId: z.string().nullable().optional(),
      originPortId: z.string().nullable().optional(),
      destinationPortId: z.string().nullable().optional(),
      containerNumber: z.string().optional(),
      containerType: z.string().optional(),
      blNumber: z.string().optional(),
      vesselName: z.string().optional(),
      etd: z.string().transform((s) => new Date(s)).optional(),
      eta: z.string().transform((s) => new Date(s)).optional(),
      freightCost: z.number().min(0).optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.shipment.findFirst({
      where: { id: req.params.shipmentId, orderId: req.params.id },
    });
    if (!existing) throw new NotFoundError('Shipment');

    const { status, ...rest } = validation.data;

    const shipment = await prisma.shipment.update({
      where: { id: req.params.shipmentId },
      data: {
        ...rest,
        ...(status ? { status } : {}),
        // Stamp the real dates from the status so the two cannot contradict.
        ...(status === 'IN_TRANSIT' && !existing.actualDeparture
          ? { actualDeparture: new Date() }
          : {}),
        ...(status === 'ARRIVED' && !existing.actualArrival ? { actualArrival: new Date() } : {}),
      },
      include: { cha: true, transporter: true, originPort: true, destinationPort: true },
    });

    if (status && status !== existing.status) {
      emitEvent('shipment.status_changed', { ...shipment, previousStatus: existing.status });
    }

    res.json({ success: true, data: shipment });
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

/**
 * Packing List PDF, following the Packing List sheet of MASTER DRAFT.xlsx.
 * Generated from the order so it is available before a shipment exists; vessel
 * and port details are pulled from the first shipment when one exists.
 */
router.get('/:id/packing-list', can('OPERATIONS_VIEW'), async (req, res, next) => {
  try {
    const order = await prisma.exportOrder.findUnique({
      where: { id: req.params.id },
      include: {
        buyer: { include: { country: true, contacts: { where: { isPrimary: true } } } },
        items: { include: { product: true } },
        shipments: { include: { originPort: true, destinationPort: true } },
        portOfLoading: { include: { country: true } },
        portOfDischarge: { include: { country: true } },
        invoices: { select: { invoiceNumber: true }, orderBy: { createdAt: 'asc' } },
      },
    });

    if (!order) throw new NotFoundError('Order');

    const company = await prisma.companyProfile.findFirst();
    if (!company) {
      throw new AppError(
        'Company profile is not set up. Seed the database or add it in Settings before generating documents.',
        400
      );
    }

    const pdfBuffer = await buildPackingListDocument(order, company);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="PackingList-${order.orderNumber}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

/**
 * Record packing figures against an order line. These feed the Packing List and
 * the weight summary printed on commercial and proforma invoices.
 */
const packingSchema = z.object({
  numberOfPackages: z.number().int().positive().nullable().optional(),
  packageWeight: z.number().positive().nullable().optional(),
  netWeight: z.number().positive().nullable().optional(),
  grossWeight: z.number().positive().nullable().optional(),
});

router.put('/:id/items/:itemId/packing', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    const data = packingSchema.parse(req.body);

    const item = await prisma.orderItem.findFirst({
      where: { id: req.params.itemId, orderId: req.params.id },
    });
    if (!item) throw new NotFoundError('Order item');

    // Gross must cover net, otherwise the packing list contradicts itself.
    const net = data.netWeight ?? Number(item.netWeight ?? 0);
    const gross = data.grossWeight ?? Number(item.grossWeight ?? 0);
    if (net && gross && gross < net) {
      throw new AppError('Gross weight cannot be less than net weight', 400);
    }

    const updated = await prisma.orderItem.update({
      where: { id: req.params.itemId },
      data,
      include: { product: true },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

/** Cancel an order. Blocked once goods have shipped or an invoice exists. */
router.put('/:id/cancel', can('RECORD_DELETE'), async (req, res, next) => {
  try {
    const result = await cancelOrder(req.params.id, req.body?.reason);
    res.json({ success: true, data: result, message: result.message });
  } catch (error) {
    next(error);
  }
});

export { router as orderRouter };
