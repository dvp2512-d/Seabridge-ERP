/**
 * Email Queue Management Routes
 * 
 * Admin endpoints for managing the email queue.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError } from '../middleware/errorHandler';
import {
  getEmailQueueStats,
  processEmailQueue,
  retryFailedEmails,
  isEmailConfigured,
  queueEmail,
} from '../services/emailService';

const router: Router = Router();

router.use(authenticate);

// Get email configuration status and queue stats
router.get('/status', can('SETTINGS_VIEW'), async (req, res, next) => {
  try {
    const stats = await getEmailQueueStats();
    const configured = isEmailConfigured();

    res.json({
      success: true,
      data: {
        configured,
        configurationHint: configured
          ? 'SMTP is configured'
          : 'Set SMTP_HOST, SMTP_USER, SMTP_PASS environment variables',
        queue: stats,
      },
    });
  } catch (error) {
    next(error);
  }
});

// List queued emails
router.get('/', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;

    const where: any = {};
    if (status) where.status = status;

    const [emails, total] = await Promise.all([
      prisma.emailQueue.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        select: {
          id: true,
          to: true,
          subject: true,
          status: true,
          attempts: true,
          error: true,
          sentAt: true,
          createdAt: true,
        },
      }),
      prisma.emailQueue.count({ where }),
    ]);

    res.json({
      success: true,
      data: emails,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get single email details
router.get('/:id', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const email = await prisma.emailQueue.findUnique({
      where: { id: req.params.id },
    });

    if (!email) {
      return res.status(404).json({ success: false, message: 'Email not found' });
    }

    res.json({ success: true, data: email });
  } catch (error) {
    next(error);
  }
});

// Send a test email
router.post('/test', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      to: z.string().email('Invalid email address'),
      subject: z.string().optional().default('Test Email from SeaBridge ERP'),
      body: z.string().optional().default('This is a test email to verify your SMTP configuration is working correctly.'),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      throw new ValidationError(validation.error.errors);
    }

    if (!isEmailConfigured()) {
      return res.status(400).json({
        success: false,
        message: 'Email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS environment variables.',
      });
    }

    const emailId = await queueEmail(validation.data);

    // Immediately process this email
    await processEmailQueue(1);

    // Check if it was sent
    const email = await prisma.emailQueue.findUnique({ where: { id: emailId } });

    res.json({
      success: true,
      data: {
        emailId,
        status: email?.status,
        error: email?.error,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Manually trigger queue processing
router.post('/process', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    if (!isEmailConfigured()) {
      return res.status(400).json({
        success: false,
        message: 'Email is not configured',
      });
    }

    const batchSize = Number(req.query.batchSize) || 10;
    const result = await processEmailQueue(batchSize);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// Retry all failed emails
router.post('/retry-failed', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const count = await retryFailedEmails();

    res.json({
      success: true,
      data: { retriedCount: count },
    });
  } catch (error) {
    next(error);
  }
});

// Delete old sent/failed emails (cleanup)
router.delete('/cleanup', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const daysOld = Number(req.query.daysOld) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await prisma.emailQueue.deleteMany({
      where: {
        status: { in: ['SENT', 'FAILED'] },
        createdAt: { lt: cutoffDate },
      },
    });

    res.json({
      success: true,
      data: { deletedCount: result.count },
    });
  } catch (error) {
    next(error);
  }
});

export { router as emailRouter };
