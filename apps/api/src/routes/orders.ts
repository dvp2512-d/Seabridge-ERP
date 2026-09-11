import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';
import { createOrderFromQuotation } from '../services/orderService';
import { getBaseCurrency } from '../services/exchangeRateService';
import { emitEvent } from '../services/eventService';
import { generatePurchaseOrderPDF } from '../services/pdfService';
import {
  syncProcurementExpense,
  syncShipmentExpenses,
} from '../services/expenseSyncService';
import { assessOrderDocuments } from '../services/documentReadiness';

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
      // Pipeline counts and value across the whole filtered set, not just this
      // page. Every amount is INR, so this is a plain aggregate.
      prisma.exportOrder.groupBy({
        by: ['status'],
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

    const countByStatus: Record<string, number> = {};
    let totalValue = 0;

    for (const group of statusGroups) {
      countByStatus[group.status] = group._count._all;
      totalValue += Number(group._sum.totalValue ?? 0);
    }

    res.json({
      success: true,
      data: orders,
      pagination: { page: Number(page), limit: Number(limit), total },
      summary: {
        baseCurrency: await getBaseCurrency(),
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

    emitEvent('order.created', order);
    res.status(201).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
});

// Update order status
router.put('/:id', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    // Helper to transform date strings, treating empty strings as undefined
    const dateString = z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.string().transform(s => new Date(s)).optional()
    );

    const schema = z.object({
      status: z.enum(['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'CANCELLED']).optional(),
      expectedDate: dateString,
      poNumber: z.string().optional(),
      notes: z.string().optional(),
      // Header fields printed on every document raised against this order. The
      // columns existed and the PDFs read them, but nothing could set them, so the
      // dispatch and shipment-type boxes printed whatever could be inferred from
      // the port and the proforma's tolerance box was always empty.
      dispatchMethod: z.enum(['SEA', 'AIR', 'ROAD']).nullable().optional(),
      shipmentType: z.string().nullable().optional(),
      variationPercent: z.number().min(0).max(100).nullable().optional(),
      // The party invoiced when it is not the consignee. Empty string clears it,
      // because a select with no selection submits '' rather than null.
      billToBuyerId: z
        .string()
        .nullable()
        .optional()
        .transform((v) => (v === '' ? null : v)),
      // Terms printed in the "Terms of Delivery ( Incoterms ) and Payment" box.
      paymentTerms: z.string().nullable().optional(),
      deliveryTerms: z.string().nullable().optional(),
      portOfLoadingId: z.string().nullable().optional().transform((v) => (v === '' ? null : v)),
      portOfDischargeId: z.string().nullable().optional().transform((v) => (v === '' ? null : v)),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.exportOrder.findUnique({
      where: { id: req.params.id },
      select: { id: true, buyerId: true },
    });
    if (!existing) throw new NotFoundError('Order');

    // Billing the consignee is the default and is expressed by leaving this empty,
    // so naming the same party twice is a mistake worth catching.
    if (validation.data.billToBuyerId && validation.data.billToBuyerId === existing.buyerId) {
      throw new AppError(
        'The bill-to party is the same as the consignee. Leave it empty when they are the same buyer.',
        400
      );
    }

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
    // Helper to transform date strings, treating empty strings as undefined
    const dateString = z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.string().transform(s => new Date(s)).optional()
    );

    const schema = z.object({
      supplierId: z.string().min(1),
      totalAmount: z.number().positive(),
      currency: z.string().optional(),
      expectedDate: dateString,
      notes: z.string().optional(),
      // The boxes on the PO sheet. Each one printed empty before, so a supplier
      // received an order with no delivery point, packing spec or quality clause.
      deliveryAddress: z.string().optional(),
      modeOfDelivery: z.string().optional(),
      paymentMode: z.string().optional(),
      pickupLocation: z.string().optional(),
      destination: z.string().optional(),
      packingInstructions: z.string().optional(),
      qualityRequirement: z.string().optional(),
      variationPercent: z.number().min(0).max(100).optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    // Verify order exists
    const order = await prisma.exportOrder.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!order) throw new NotFoundError('Order');

    // Verify supplier exists
    const supplier = await prisma.supplier.findUnique({
      where: { id: validation.data.supplierId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundError('Supplier');

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

    // Ordering from a supplier is what creates the obligation, so the payable is
    // raised now rather than on delivery. Mirroring must not fail the save.
    const expense = await syncProcurementExpense(procurement.id).catch((error) => {
      console.error(`[expense-sync] procurement ${procurement.id}:`, error);
      return null;
    });

    res.status(201).json({ success: true, data: procurement, expenseSync: expense });
  } catch (error) {
    next(error);
  }
});

/**
 * Update a supplier purchase order.
 *
 * The amount and status are routinely corrected after the fact - a supplier
 * confirms a different rate, or part of the order is received - and without this
 * the only way to change either was to delete and re-create. The matching expense
 * follows the new amount unless it has already been paid against.
 */
router.put('/:orderId/procurements/:procId', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    const dateString = z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.string().transform((s) => new Date(s)).optional()
    );

    const schema = z.object({
      supplierId: z.string().min(1).optional(),
      totalAmount: z.number().positive().optional(),
      status: z.enum(['PENDING', 'ORDERED', 'RECEIVED', 'PARTIAL']).optional(),
      expectedDate: dateString,
      receivedDate: dateString,
      notes: z.string().optional(),
      // Nullable on update so a box filled in error can be emptied again.
      deliveryAddress: z.string().nullable().optional(),
      modeOfDelivery: z.string().nullable().optional(),
      paymentMode: z.string().nullable().optional(),
      pickupLocation: z.string().nullable().optional(),
      destination: z.string().nullable().optional(),
      packingInstructions: z.string().nullable().optional(),
      qualityRequirement: z.string().nullable().optional(),
      variationPercent: z.number().min(0).max(100).nullable().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.procurement.findUnique({
      where: { id: req.params.procId },
      select: { id: true, orderId: true },
    });
    if (!existing) throw new NotFoundError('Procurement');
    if (existing.orderId !== req.params.orderId) {
      throw new NotFoundError('Procurement not found for this order');
    }

    const procurement = await prisma.procurement.update({
      where: { id: req.params.procId },
      data: validation.data,
      include: { supplier: true },
    });

    const expense = await syncProcurementExpense(procurement.id).catch((error) => {
      console.error(`[expense-sync] procurement ${procurement.id}:`, error);
      return null;
    });

    res.json({ success: true, data: procurement, expenseSync: expense });
  } catch (error) {
    next(error);
  }
});

// Add shipment
router.post('/:id/shipments', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    // Helper to transform date strings, treating empty strings as undefined
    const dateString = z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.string().transform(s => new Date(s)).optional()
    );

    const schema = z.object({
      chaId: z.string().optional(),
      transporterId: z.string().optional(),
      originPortId: z.string().optional(),
      destinationPortId: z.string().optional(),
      containerNumber: z.string().optional(),
      containerType: z.string().optional(),
      // Carrier details, which the documents print. These were missing, so a
      // vessel name or BL number could not be recorded through the API at all.
      vesselName: z.string().optional(),
      blNumber: z.string().optional(),
      status: z.enum(['PENDING', 'BOOKED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED']).optional(),
      // Costs. Each one entered raises the matching expense.
      freightCost: z.number().nonnegative().optional(),
      chaCharges: z.number().nonnegative().optional(),
      transportCharges: z.number().nonnegative().optional(),
      etd: dateString,
      eta: dateString,
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    // Verify order exists
    const order = await prisma.exportOrder.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!order) throw new NotFoundError('Order');

    const shipmentNumber = await generateCode('SHIPMENT', 'SHP');

    const shipment = await prisma.shipment.create({
      data: {
        ...validation.data,
        orderId: req.params.id,
        shipmentNumber,
      },
      include: { cha: true, transporter: true, originPort: true, destinationPort: true },
    });

    const expenses = await syncShipmentExpenses(shipment.id).catch((error) => {
      console.error(`[expense-sync] shipment ${shipment.id}:`, error);
      return [];
    });

    res.status(201).json({ success: true, data: shipment, expenseSync: expenses });
  } catch (error) {
    next(error);
  }
});

/**
 * Update a shipment.
 *
 * Freight, CHA and transport charges usually arrive after the shipment is booked -
 * the CHA invoices once clearance is done - so without an update endpoint those
 * costs could never be recorded. Saving any of them raises or corrects the matching
 * expense; see services/expenseSyncService.ts for what happens when one has already
 * been paid.
 */
router.put('/:orderId/shipments/:shipmentId', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    const dateString = z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.string().transform((s) => new Date(s)).optional()
    );

    const schema = z.object({
      chaId: z.string().optional(),
      transporterId: z.string().optional(),
      originPortId: z.string().optional(),
      destinationPortId: z.string().optional(),
      containerNumber: z.string().optional(),
      containerType: z.string().optional(),
      vesselName: z.string().optional(),
      blNumber: z.string().optional(),
      status: z.enum(['PENDING', 'BOOKED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED']).optional(),
      // Nullable, so clearing a cost entered in error removes its expense.
      freightCost: z.number().nonnegative().nullable().optional(),
      chaCharges: z.number().nonnegative().nullable().optional(),
      transportCharges: z.number().nonnegative().nullable().optional(),
      etd: dateString,
      eta: dateString,
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.shipment.findUnique({
      where: { id: req.params.shipmentId },
      select: { id: true, orderId: true },
    });
    if (!existing) throw new NotFoundError('Shipment');
    if (existing.orderId !== req.params.orderId) {
      throw new NotFoundError('Shipment not found for this order');
    }

    const shipment = await prisma.shipment.update({
      where: { id: req.params.shipmentId },
      data: validation.data,
      include: { cha: true, transporter: true, originPort: true, destinationPort: true },
    });

    const expenses = await syncShipmentExpenses(shipment.id).catch((error) => {
      console.error(`[expense-sync] shipment ${shipment.id}:`, error);
      return [];
    });

    res.json({ success: true, data: shipment, expenseSync: expenses });
  } catch (error) {
    next(error);
  }
});

/**
 * Update an order line's packing figures.
 *
 * These four numbers are the Packing List, and they appear in the weight block of
 * every invoice. Nothing could set them before, so the packing list printed with
 * empty weight columns however complete the rest of the order was.
 *
 * Quantity and price are deliberately not editable here. They came from the
 * accepted quotation and are what the buyer agreed; changing them would put the
 * order's totalValue, the invoice raised from it and the quotation out of step with
 * each other. Revising the quotation is the way to change a price.
 *
 * Every figure is nullable, because "not yet weighed" is a real state and is
 * different from zero. A blank prints as blank rather than as 0.00 KGS.
 */
router.put('/:orderId/items/:itemId', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      numberOfPackages: z.number().int().nonnegative().nullable().optional(),
      packageWeight: z.number().nonnegative().nullable().optional(),
      netWeight: z.number().nonnegative().nullable().optional(),
      grossWeight: z.number().nonnegative().nullable().optional(),
      notes: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.orderItem.findUnique({
      where: { id: req.params.itemId },
      select: { id: true, orderId: true },
    });
    if (!existing) throw new NotFoundError('Order item');
    if (existing.orderId !== req.params.orderId) {
      throw new NotFoundError('Item not found for this order');
    }

    const { netWeight, grossWeight } = validation.data;

    /**
     * Gross weight is the goods plus their packaging, so it cannot be less than
     * net. Caught here because the pair is what a shipping line weighs against and
     * a transposed entry would be argued about at the port rather than noticed.
     */
    if (
      netWeight !== null &&
      netWeight !== undefined &&
      grossWeight !== null &&
      grossWeight !== undefined &&
      grossWeight < netWeight
    ) {
      throw new AppError(
        `Gross weight (${grossWeight}) cannot be less than net weight (${netWeight}). ` +
          'Gross includes the packaging.',
        400
      );
    }

    const item = await prisma.orderItem.update({
      where: { id: req.params.itemId },
      data: validation.data,
      include: { product: true },
    });

    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

/**
 * What each document raised against this order would contain, and what is missing.
 *
 * Answers the question before a document is sent rather than after. Also reports
 * when each was last generated and in what currency - both are recorded on every
 * generation but were never shown anywhere, so there was no way to tell whether the
 * copy a buyer holds is the current one.
 */
router.get('/:id/document-readiness', can('OPERATIONS_VIEW'), async (req, res, next) => {
  try {
    const order = await prisma.exportOrder.findUnique({
      where: { id: req.params.id },
      include: {
        buyer: { include: { country: true } },
        incoterm: true,
        portOfLoading: true,
        portOfDischarge: true,
        items: { include: { product: true } },
        shipments: {
          include: { originPort: true, destinationPort: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        invoices: {
          select: {
            id: true,
            invoiceNumber: true,
            type: true,
            pdfGeneratedAt: true,
            pdfCurrency: true,
            pdfExchangeRate: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        quotation: {
          select: {
            id: true,
            quotationNumber: true,
            pdfGeneratedAt: true,
            pdfCurrency: true,
            pdfExchangeRate: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundError('Order');

    const companyProfile = await prisma.companyProfile.findFirst();
    const readiness = assessOrderDocuments(order, companyProfile);

    // Attach the most recent generation for each document type, so the UI can show
    // readiness and history together rather than in two places.
    const withHistory = readiness.map((entry) => {
      const issued = order.invoices.filter((i) => i.type === entry.document);
      const latest = issued.find((i) => i.pdfGeneratedAt !== null) ?? null;
      return {
        ...entry,
        existing: issued.map((i) => ({
          id: i.id,
          number: i.invoiceNumber,
          generatedAt: i.pdfGeneratedAt,
          currency: i.pdfCurrency,
          rate: i.pdfExchangeRate,
        })),
        lastGeneratedAt: latest?.pdfGeneratedAt ?? null,
        lastCurrency: latest?.pdfCurrency ?? null,
      };
    });

    res.json({
      success: true,
      data: {
        documents: withHistory,
        quotation: order.quotation,
      },
    });
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

// Download Purchase Order PDF
router.get('/:orderId/procurements/:procId/pdf', can('OPERATIONS_VIEW'), async (req, res, next) => {
  try {
    const procurement = await prisma.procurement.findUnique({
      where: { id: req.params.procId },
      include: {
        supplier: { include: { country: true } },
        // The PO lists the goods ordered, so the order's items and their products
        // are needed - selecting only the order number left the table empty.
        order: {
          select: {
            id: true,
            orderNumber: true,
            items: { include: { product: true } },
          },
        },
      },
    });

    if (!procurement) throw new NotFoundError('Procurement');
    if (procurement.orderId !== req.params.orderId) {
      throw new NotFoundError('Procurement not found for this order');
    }

    const companyProfile = await prisma.companyProfile.findFirst();

    const pdfBuffer = await generatePurchaseOrderPDF(procurement, { companyProfile });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${procurement.poNumber || 'PO-DRAFT'}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

export { router as orderRouter };
