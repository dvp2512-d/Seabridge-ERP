import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../middleware/errorHandler';
import crypto from 'crypto';

const router: Router = Router();

router.use(authenticate);

// ============================================
// WEBHOOKS
// ============================================

// List webhooks
router.get('/webhooks', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const webhooks = await prisma.webhook.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: webhooks });
  } catch (error) {
    next(error);
  }
});

// Create webhook
router.post('/webhooks', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      url: z.string().url(),
      events: z.array(z.string()),
      secret: z.string().optional(),
      isActive: z.boolean().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const webhook = await prisma.webhook.create({
      data: {
        ...validation.data,
        secret: validation.data.secret || crypto.randomBytes(32).toString('hex'),
      },
    });

    res.status(201).json({ success: true, data: webhook });
  } catch (error) {
    next(error);
  }
});

// Update webhook
router.put('/webhooks/:id', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      url: z.string().url().optional(),
      events: z.array(z.string()).optional(),
      isActive: z.boolean().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const webhook = await prisma.webhook.update({
      where: { id: req.params.id },
      data: validation.data,
    });

    res.json({ success: true, data: webhook });
  } catch (error) {
    next(error);
  }
});

// Delete webhook
router.delete('/webhooks/:id', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    await prisma.webhook.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Webhook deleted' });
  } catch (error) {
    next(error);
  }
});

// Test webhook
router.post('/webhooks/:id/test', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const webhook = await prisma.webhook.findUnique({
      where: { id: req.params.id },
    });

    if (!webhook) throw new NotFoundError('Webhook');

    // Send test payload
    const testPayload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook from SeaBridge ERP' },
    };

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhook.secret || '',
          'X-Webhook-Event': 'test',
        },
        body: JSON.stringify(testPayload),
      });

      res.json({
        success: true,
        data: {
          status: response.status,
          statusText: response.statusText,
          delivered: response.ok,
        },
      });
    } catch (fetchError: any) {
      res.json({
        success: false,
        data: {
          delivered: false,
          error: fetchError.message,
        },
      });
    }
  } catch (error) {
    next(error);
  }
});

// ============================================
// TEMPLATES
// ============================================

// List templates
router.get('/templates', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const { type } = req.query;
    const where: any = {};
    if (type) where.type = type;

    const templates = await prisma.template.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: templates });
  } catch (error) {
    next(error);
  }
});

// Get template by ID
router.get('/templates/:id', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const template = await prisma.template.findUnique({
      where: { id: req.params.id },
    });
    if (!template) throw new NotFoundError('Template');
    res.json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
});

// Create template
router.post('/templates', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      type: z.enum(['EMAIL', 'QUOTATION', 'INVOICE', 'DOCUMENT']),
      subject: z.string().optional(),
      content: z.string().min(1),
      variables: z.array(z.string()).optional(),
      isDefault: z.boolean().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    // If setting as default, unset other defaults of same type
    if (validation.data.isDefault) {
      await prisma.template.updateMany({
        where: { type: validation.data.type, isDefault: true },
        data: { isDefault: false },
      });
    }

    const template = await prisma.template.create({
      data: validation.data,
    });

    res.status(201).json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
});

// Update template
router.put('/templates/:id', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      subject: z.string().optional(),
      content: z.string().optional(),
      variables: z.array(z.string()).optional(),
      isDefault: z.boolean().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.template.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) throw new NotFoundError('Template');

    // If setting as default, unset other defaults of same type
    if (validation.data.isDefault) {
      await prisma.template.updateMany({
        where: { type: existing.type, isDefault: true, id: { not: req.params.id } },
        data: { isDefault: false },
      });
    }

    const template = await prisma.template.update({
      where: { id: req.params.id },
      data: validation.data,
    });

    res.json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
});

// Delete template
router.delete('/templates/:id', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    await prisma.template.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Template deleted' });
  } catch (error) {
    next(error);
  }
});

// ============================================
// AUTOMATION RULES
// ============================================

// List automation rules
router.get('/automations', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const automations = await prisma.automationRule.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: automations });
  } catch (error) {
    next(error);
  }
});

// Create automation rule
router.post('/automations', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      trigger: z.string().min(1),
      conditions: z.any().optional(),
      actions: z.array(z.any()),
      isActive: z.boolean().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const automation = await prisma.automationRule.create({
      data: validation.data,
    });

    res.status(201).json({ success: true, data: automation });
  } catch (error) {
    next(error);
  }
});

// Update automation rule
router.put('/automations/:id', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      trigger: z.string().optional(),
      conditions: z.any().optional(),
      actions: z.array(z.any()).optional(),
      isActive: z.boolean().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const automation = await prisma.automationRule.update({
      where: { id: req.params.id },
      data: validation.data,
    });

    res.json({ success: true, data: automation });
  } catch (error) {
    next(error);
  }
});

// Delete automation rule
router.delete('/automations/:id', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    await prisma.automationRule.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Automation rule deleted' });
  } catch (error) {
    next(error);
  }
});

// ============================================
// WEBHOOK EVENTS (Available events)
// ============================================

router.get('/webhook-events', can('SETTINGS_MANAGE'), async (req, res) => {
  const events = [
    { category: 'Inquiry', events: ['inquiry.created', 'inquiry.updated', 'inquiry.stage_changed', 'inquiry.won', 'inquiry.lost'] },
    { category: 'Quotation', events: ['quotation.created', 'quotation.sent', 'quotation.accepted', 'quotation.rejected', 'quotation.expired'] },
    { category: 'Order', events: ['order.created', 'order.status_changed', 'order.shipped', 'order.delivered'] },
    { category: 'Invoice', events: ['invoice.created', 'invoice.sent', 'invoice.paid', 'invoice.overdue'] },
    { category: 'Payment', events: ['payment.received'] },
    { category: 'Shipment', events: ['shipment.created', 'shipment.departed', 'shipment.arrived'] },
  ];

  res.json({ success: true, data: events });
});

// ============================================
// TEMPLATE VARIABLES
// ============================================

router.get('/template-variables', can('SETTINGS_MANAGE'), async (req, res) => {
  const variables = {
    buyer: ['{{buyer.companyName}}', '{{buyer.code}}', '{{buyer.email}}', '{{buyer.phone}}', '{{buyer.address}}', '{{buyer.city}}', '{{buyer.country}}'],
    quotation: ['{{quotation.number}}', '{{quotation.date}}', '{{quotation.validUntil}}', '{{quotation.total}}', '{{quotation.currency}}', '{{quotation.incoterm}}'],
    order: ['{{order.number}}', '{{order.date}}', '{{order.expectedDate}}', '{{order.total}}', '{{order.status}}'],
    invoice: ['{{invoice.number}}', '{{invoice.date}}', '{{invoice.dueDate}}', '{{invoice.total}}', '{{invoice.balance}}', '{{invoice.status}}'],
    company: ['{{company.name}}', '{{company.address}}', '{{company.email}}', '{{company.phone}}', '{{company.website}}'],
    user: ['{{user.firstName}}', '{{user.lastName}}', '{{user.email}}'],
  };

  res.json({ success: true, data: variables });
});

export { router as automationRouter };
