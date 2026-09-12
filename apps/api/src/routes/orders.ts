import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';
import { generateCode } from '../utils/helpers';
import { createOrderFromQuotation, fillOrderPacking } from '../services/orderService';
import { getBaseCurrency } from '../services/exchangeRateService';
import { emitEvent } from '../services/eventService';
import { generatePurchaseOrderPDF } from '../services/pdfService';
import {
  syncProcurementExpense,
  syncShipmentExpenses,
} from '../services/expenseSyncService';
import { assessOrderDocuments } from '../services/documentReadiness';
import { priceProcurementLines } from '../services/procurementPricing';
import { PACKAGE_TYPES } from '../utils/packageTypes';

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
        procurements: {
          include: { supplier: true, items: { include: { product: true } } },
        },
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

/**
 * Suggested purchase order lines for a supplier.
 *
 * Answers "what am I buying and at what price" without anyone typing it: the
 * products come from the export order, the quantities from its lines, the rate from
 * this supplier's own price list, and the GST from the product.
 *
 * A product with no price on file is returned with a rate of zero and
 * `priceFound: false` rather than being omitted. Leaving it out would silently
 * shorten the order; returning it flagged shows exactly what still needs a price
 * agreed, which is the useful answer.
 *
 * Nothing is saved. The operator can change any rate before creating the order,
 * because a price list is a starting point and not a contract.
 */
router.get('/:orderId/procurements/suggest', can('OPERATIONS_VIEW'), async (req, res, next) => {
  try {
    const supplierId = String(req.query.supplierId ?? '');
    if (!supplierId) throw new AppError('Choose a supplier first.', 400);

    const [order, supplier] = await Promise.all([
      prisma.exportOrder.findUnique({
        where: { id: req.params.orderId },
        include: { items: { include: { product: true } } },
      }),
      prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true, name: true, paymentTerms: true, address: true },
      }),
    ]);

    if (!order) throw new NotFoundError('Order');
    if (!supplier) throw new NotFoundError('Supplier');

    const productIds = order.items.map((i) => i.productId);

    /**
     * The supplier's current prices for these products.
     *
     * Filtered to prices in force today, because an expired rate is not a rate. The
     * newest applicable one wins where a supplier has several - a price list is
     * revised by adding a row, not by editing the old one.
     */
    const now = new Date();
    const prices = await prisma.supplierPrice.findMany({
      where: {
        supplierId,
        productId: { in: productIds },
        isActive: true,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      orderBy: { validFrom: 'desc' },
    });

    const lines = order.items.map((item) => {
      const quantity = Number(item.quantity);

      // A minimum quantity this order does not reach means the price does not apply
      // to it, so it is not offered.
      const price = prices.find(
        (p) =>
          p.productId === item.productId &&
          (p.minQuantity === null || quantity >= Number(p.minQuantity))
      );

      const gstRate = item.product.gstRate === null ? null : Number(item.product.gstRate);

      return {
        productId: item.productId,
        productName: item.product.name,
        productCode: item.product.code,
        hsnCode: item.product.hsnCode,
        quantity,
        unit: item.unit,
        rate: price ? Number(price.price) : 0,
        taxPercent: gstRate,
        priceFound: Boolean(price),
        /** The price quoted to the buyer, for reference while negotiating. */
        buyerUnitPrice: Number(item.unitPrice),
      };
    });

    const totals = priceProcurementLines(lines);

    res.json({
      success: true,
      data: {
        supplier,
        lines: lines.map((line, i) => ({ ...line, ...totals.lines[i] })),
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        /** Products with no current price from this supplier. */
        missingPrices: lines.filter((l) => !l.priceFound).map((l) => l.productName),
        linesWithoutTax: totals.linesWithoutTax,
        // Sensible defaults for the rest of the form, so a repeat purchase needs
        // little more than a confirmation.
        defaults: {
          paymentMode: supplier.paymentTerms ?? null,
          pickupLocation: supplier.address ?? null,
        },
      },
    });
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
      /**
       * The agreed total, for a purchase order raised without line items.
       *
       * Optional now: when `items` are given the total is computed from them and
       * anything sent here is ignored, because a total that can be typed
       * independently of the lines is a total that will eventually contradict them.
       */
      totalAmount: z.number().positive().optional(),
      /** Lines at the supplier's price. rate x quantity + GST becomes the total. */
      items: z
        .array(
          z.object({
            productId: z.string().min(1),
            quantity: z.number().positive(),
            unit: z.string().optional(),
            rate: z.number().nonnegative(),
            taxPercent: z.number().min(0).max(100).nullable().optional(),
            notes: z.string().optional(),
          })
        )
        .optional(),
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

    const { items, totalAmount: typedTotal, ...fields } = validation.data;

    /**
     * The total comes from the lines when there are lines.
     *
     * A purchase order raised without them keeps the typed figure, which is how
     * every order worked before line items existed and is still valid for a one-off
     * purchase with nothing to itemise. One of the two must be present, or the order
     * would have no value at all.
     */
    const priced = items && items.length > 0 ? priceProcurementLines(items) : null;

    if (!priced && typedTotal === undefined) {
      throw new AppError(
        'Add at least one line item, or enter the agreed total amount.',
        400
      );
    }

    const subtotal = priced ? priced.subtotal : (typedTotal as number);
    const taxAmount = priced ? priced.taxAmount : 0;
    const total = priced ? priced.totalAmount : (typedTotal as number);

    const procurement = await prisma.procurement.create({
      data: {
        ...fields,
        orderId: req.params.id,
        poNumber,
        orderDate: new Date(),
        subtotal,
        taxAmount,
        totalAmount: total,
        ...(priced
          ? {
              items: {
                create: priced.lines.map((line) => ({
                  productId: line.productId,
                  quantity: line.quantity,
                  unit: line.unit,
                  rate: line.rate,
                  taxPercent: line.taxPercent,
                  amount: line.amount,
                  taxAmount: line.taxAmount,
                  notes: line.notes,
                })),
              },
            }
          : {}),
      },
      include: { supplier: true, items: { include: { product: true } } },
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
      /**
       * Replaces the lines wholesale when given.
       *
       * A purchase order is a short document that gets revised as a whole - a rate
       * is renegotiated and it is reissued - so replacing the set is closer to how
       * it is used than patching individual lines, and it keeps the total and the
       * lines derived from one write.
       */
      items: z
        .array(
          z.object({
            productId: z.string().min(1),
            quantity: z.number().positive(),
            unit: z.string().optional(),
            rate: z.number().nonnegative(),
            taxPercent: z.number().min(0).max(100).nullable().optional(),
            notes: z.string().optional(),
          })
        )
        .optional(),
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

    const { items, ...fields } = validation.data;
    const priced = items ? priceProcurementLines(items) : null;

    // Replacing the lines and recomputing the total is one transaction: a total that
    // survived a failed line write would be a figure with nothing behind it.
    const procurement = await prisma.$transaction(async (tx) => {
      if (priced) {
        await tx.procurementItem.deleteMany({ where: { procurementId: req.params.procId } });
      }

      return tx.procurement.update({
        where: { id: req.params.procId },
        data: {
          ...fields,
          ...(priced
            ? {
                subtotal: priced.subtotal,
                taxAmount: priced.taxAmount,
                totalAmount: priced.totalAmount,
                items: {
                  create: priced.lines.map((line) => ({
                    productId: line.productId,
                    quantity: line.quantity,
                    unit: line.unit,
                    rate: line.rate,
                    taxPercent: line.taxPercent,
                    amount: line.amount,
                    taxAmount: line.taxAmount,
                    notes: line.notes,
                  })),
                },
              }
            : {}),
        },
        include: { supplier: true, items: { include: { product: true } } },
      });
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
      // What the goods are packed in. Validated against the shared list so a typo
      // cannot reach a packing list a customs officer reads.
      packageType: z.enum(PACKAGE_TYPES).nullable().optional(),
      packageWeight: z.number().nonnegative().nullable().optional(),
      netWeight: z.number().nonnegative().nullable().optional(),
      grossWeight: z.number().nonnegative().nullable().optional(),
      notes: z.string().optional(),
      specifications: z.string().nullable().optional(),
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

/**
 * Fill every line's packing figures from the agreed packing and the product defaults.
 *
 * For orders that predate the packaging fields, or whose products had no packaging set
 * at the time. Only fills what is empty unless `overwrite` is asked for, so weighed
 * figures are never replaced by computed ones.
 */
router.post('/:id/items/fill-packing', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({ overwrite: z.boolean().optional() });
    const validation = schema.safeParse(req.body ?? {});
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const order = await prisma.exportOrder.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!order) throw new NotFoundError('Order');

    const result = await fillOrderPacking(req.params.id, {
      overwrite: validation.data.overwrite,
    });

    res.json({ success: true, data: result });
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

    // Verify document belongs to this order
    const existing = await prisma.document.findUnique({
      where: { id: req.params.docId },
      select: { id: true, orderId: true },
    });
    if (!existing) throw new NotFoundError('Document');
    if (existing.orderId !== req.params.orderId) {
      throw new NotFoundError('Document not found for this order');
    }

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
        // The purchase order's own lines, at supplier rates. The order's items are
        // still fetched as a fallback for purchase orders raised before lines
        // existed; see generatePurchaseOrderPDF.
        items: { include: { product: true } },
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
