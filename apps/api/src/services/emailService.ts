/**
 * Email Notification Service
 * 
 * Provides email sending capability with queue processing for reliability.
 * 
 * Features:
 * - Queue-based sending for reliability
 * - Template support with variable substitution
 * - Retry with exponential backoff
 * - Support for multiple SMTP providers
 * 
 * Configuration (environment variables):
 * - SMTP_HOST: SMTP server hostname
 * - SMTP_PORT: SMTP server port (default: 587)
 * - SMTP_SECURE: Use TLS (default: false for port 587)
 * - SMTP_USER: SMTP username
 * - SMTP_PASS: SMTP password
 * - SMTP_FROM: Default from address
 * - SMTP_FROM_NAME: Default from name
 */
import { prisma } from '@seabridge/database';
import { logger } from '../utils/logger';
import nodemailer from 'nodemailer';

// Email configuration
interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
  fromName: string;
}

// Get email configuration from environment
function getEmailConfig(): EmailConfig | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return {
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
    from: process.env.SMTP_FROM || user,
    fromName: process.env.SMTP_FROM_NAME || 'SeaBridge ERP',
  };
}

// Create nodemailer transporter
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;
  
  const config = getEmailConfig();
  if (!config) {
    logger.warn('Email not configured - SMTP_HOST, SMTP_USER, SMTP_PASS required');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });

  return transporter;
}

// Email template types
export type EmailTemplate = 
  | 'quotation_sent'
  | 'quotation_expiring'
  | 'order_confirmed'
  | 'order_shipped'
  | 'invoice_sent'
  | 'invoice_overdue'
  | 'payment_received'
  | 'welcome'
  | 'password_reset';

// Template definitions
const TEMPLATES: Record<EmailTemplate, { subject: string; body: string }> = {
  quotation_sent: {
    subject: 'Quotation {{quotationNumber}} - {{companyName}}',
    body: `Dear {{contactName}},

Please find attached our quotation {{quotationNumber}} for your inquiry.

Quotation Details:
- Amount: {{currency}} {{amount}}
- Valid Until: {{validUntil}}

Please let us know if you have any questions.

Best regards,
{{senderName}}
{{companyName}}`,
  },
  
  quotation_expiring: {
    subject: 'Quotation {{quotationNumber}} Expiring Soon',
    body: `Dear {{contactName}},

This is a reminder that quotation {{quotationNumber}} will expire on {{expiryDate}}.

Please let us know if you would like to proceed or if you need any clarification.

Best regards,
{{senderName}}
{{companyName}}`,
  },
  
  order_confirmed: {
    subject: 'Order Confirmation - {{orderNumber}}',
    body: `Dear {{contactName}},

Thank you for your order. We are pleased to confirm order {{orderNumber}}.

Order Details:
- Order Number: {{orderNumber}}
- Total Value: {{currency}} {{amount}}
- Expected Delivery: {{deliveryDate}}

We will keep you updated on the progress.

Best regards,
{{senderName}}
{{companyName}}`,
  },
  
  order_shipped: {
    subject: 'Shipment Notification - Order {{orderNumber}}',
    body: `Dear {{contactName}},

We are pleased to inform you that your order {{orderNumber}} has been shipped.

Shipment Details:
- Vessel: {{vesselName}}
- Container: {{containerNumber}}
- BL Number: {{blNumber}}
- ETD: {{etd}}
- ETA: {{eta}}

Best regards,
{{senderName}}
{{companyName}}`,
  },
  
  invoice_sent: {
    subject: 'Invoice {{invoiceNumber}} - {{companyName}}',
    body: `Dear {{contactName}},

Please find attached invoice {{invoiceNumber}} for order {{orderNumber}}.

Invoice Details:
- Invoice Number: {{invoiceNumber}}
- Amount: {{currency}} {{amount}}
- Due Date: {{dueDate}}

Payment Details:
{{bankDetails}}

Best regards,
{{senderName}}
{{companyName}}`,
  },
  
  invoice_overdue: {
    subject: 'Payment Reminder - Invoice {{invoiceNumber}} Overdue',
    body: `Dear {{contactName}},

This is a reminder that invoice {{invoiceNumber}} is now {{daysOverdue}} days overdue.

Invoice Details:
- Invoice Number: {{invoiceNumber}}
- Amount Due: {{currency}} {{amount}}
- Original Due Date: {{dueDate}}

Please arrange payment at your earliest convenience.

Best regards,
{{senderName}}
{{companyName}}`,
  },
  
  payment_received: {
    subject: 'Payment Received - Thank You',
    body: `Dear {{contactName}},

We have received your payment of {{currency}} {{amount}} for invoice {{invoiceNumber}}.

Thank you for your prompt payment.

Best regards,
{{senderName}}
{{companyName}}`,
  },
  
  welcome: {
    subject: 'Welcome to {{companyName}}',
    body: `Dear {{contactName}},

Welcome! Your account has been created successfully.

You can now log in to access our services.

Best regards,
{{companyName}}`,
  },
  
  password_reset: {
    subject: 'Password Reset Request',
    body: `Dear {{contactName}},

You have requested a password reset. Click the link below to reset your password:

{{resetLink}}

This link will expire in 1 hour.

If you did not request this, please ignore this email.

Best regards,
{{companyName}}`,
  },
};

/**
 * Replace template variables with actual values
 */
function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => variables[key] || match);
}

/**
 * Queue an email for sending
 */
export async function queueEmail(params: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  templateId?: string;
}): Promise<string> {
  const email = await prisma.emailQueue.create({
    data: {
      to: params.to,
      subject: params.subject,
      body: params.body,
      cc: params.cc,
      bcc: params.bcc,
      templateId: params.templateId,
      status: 'PENDING',
    },
  });

  logger.info('Email queued', { emailId: email.id, to: params.to, subject: params.subject });
  return email.id;
}

/**
 * Queue an email using a template
 */
export async function queueTemplateEmail(params: {
  to: string;
  template: EmailTemplate;
  variables: Record<string, string>;
  cc?: string;
  bcc?: string;
}): Promise<string> {
  const templateDef = TEMPLATES[params.template];
  if (!templateDef) {
    throw new Error(`Unknown email template: ${params.template}`);
  }

  const subject = renderTemplate(templateDef.subject, params.variables);
  const body = renderTemplate(templateDef.body, params.variables);

  return queueEmail({
    to: params.to,
    subject,
    body,
    cc: params.cc,
    bcc: params.bcc,
    templateId: params.template,
  });
}

/**
 * Send a single email (used by processor)
 */
async function sendEmail(email: {
  id: string;
  to: string;
  cc?: string | null;
  bcc?: string | null;
  subject: string;
  body: string;
}): Promise<boolean> {
  const transport = getTransporter();
  if (!transport) {
    throw new Error('Email transport not configured');
  }

  const config = getEmailConfig()!;

  await transport.sendMail({
    from: `"${config.fromName}" <${config.from}>`,
    to: email.to,
    cc: email.cc || undefined,
    bcc: email.bcc || undefined,
    subject: email.subject,
    text: email.body,
    // TODO: Add HTML version with template
  });

  return true;
}

/**
 * Process pending emails in the queue
 * Should be called periodically (e.g., every minute via cron)
 */
export async function processEmailQueue(batchSize = 10): Promise<{
  processed: number;
  sent: number;
  failed: number;
}> {
  const transport = getTransporter();
  if (!transport) {
    logger.warn('Email queue processor skipped - SMTP not configured');
    return { processed: 0, sent: 0, failed: 0 };
  }

  // Get pending emails, prioritizing older ones
  const emails = await prisma.emailQueue.findMany({
    where: {
      status: 'PENDING',
      attempts: { lt: 5 }, // Max 5 attempts
    },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });

  let sent = 0;
  let failed = 0;

  for (const email of emails) {
    try {
      await sendEmail(email);
      
      await prisma.emailQueue.update({
        where: { id: email.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          attempts: { increment: 1 },
        },
      });
      
      sent++;
      logger.info('Email sent', { emailId: email.id, to: email.to });
    } catch (error) {
      const errorMessage = (error as Error).message;
      const newAttempts = email.attempts + 1;
      
      await prisma.emailQueue.update({
        where: { id: email.id },
        data: {
          status: newAttempts >= 5 ? 'FAILED' : 'PENDING',
          error: errorMessage,
          attempts: newAttempts,
        },
      });
      
      failed++;
      logger.error('Email send failed', { 
        emailId: email.id, 
        to: email.to, 
        error: errorMessage,
        attempts: newAttempts,
      });
    }
  }

  if (emails.length > 0) {
    logger.info('Email queue processed', { processed: emails.length, sent, failed });
  }

  return { processed: emails.length, sent, failed };
}

/**
 * Get email queue statistics
 */
export async function getEmailQueueStats() {
  const [pending, sent, failed, total] = await Promise.all([
    prisma.emailQueue.count({ where: { status: 'PENDING' } }),
    prisma.emailQueue.count({ where: { status: 'SENT' } }),
    prisma.emailQueue.count({ where: { status: 'FAILED' } }),
    prisma.emailQueue.count(),
  ]);

  return { pending, sent, failed, total };
}

/**
 * Retry failed emails
 */
export async function retryFailedEmails(): Promise<number> {
  const result = await prisma.emailQueue.updateMany({
    where: { status: 'FAILED' },
    data: { status: 'PENDING', attempts: 0, error: null },
  });

  logger.info('Failed emails reset for retry', { count: result.count });
  return result.count;
}

/**
 * Check if email is configured
 */
export function isEmailConfigured(): boolean {
  return getEmailConfig() !== null;
}

// ============================================
// NOTIFICATION TRIGGERS
// These functions are called from business logic
// ============================================

/**
 * Send quotation to buyer
 */
export async function notifyQuotationSent(params: {
  buyerEmail: string;
  buyerName: string;
  quotationNumber: string;
  amount: string;
  currency: string;
  validUntil: string;
  senderName: string;
  companyName: string;
}): Promise<string | null> {
  if (!isEmailConfigured()) return null;

  return queueTemplateEmail({
    to: params.buyerEmail,
    template: 'quotation_sent',
    variables: {
      contactName: params.buyerName,
      quotationNumber: params.quotationNumber,
      amount: params.amount,
      currency: params.currency,
      validUntil: params.validUntil,
      senderName: params.senderName,
      companyName: params.companyName,
    },
  });
}

/**
 * Send invoice to buyer
 */
export async function notifyInvoiceSent(params: {
  buyerEmail: string;
  buyerName: string;
  invoiceNumber: string;
  orderNumber: string;
  amount: string;
  currency: string;
  dueDate: string;
  bankDetails: string;
  senderName: string;
  companyName: string;
}): Promise<string | null> {
  if (!isEmailConfigured()) return null;

  return queueTemplateEmail({
    to: params.buyerEmail,
    template: 'invoice_sent',
    variables: {
      contactName: params.buyerName,
      invoiceNumber: params.invoiceNumber,
      orderNumber: params.orderNumber,
      amount: params.amount,
      currency: params.currency,
      dueDate: params.dueDate,
      bankDetails: params.bankDetails,
      senderName: params.senderName,
      companyName: params.companyName,
    },
  });
}

/**
 * Send overdue reminder
 */
export async function notifyInvoiceOverdue(params: {
  buyerEmail: string;
  buyerName: string;
  invoiceNumber: string;
  amount: string;
  currency: string;
  dueDate: string;
  daysOverdue: number;
  senderName: string;
  companyName: string;
}): Promise<string | null> {
  if (!isEmailConfigured()) return null;

  return queueTemplateEmail({
    to: params.buyerEmail,
    template: 'invoice_overdue',
    variables: {
      contactName: params.buyerName,
      invoiceNumber: params.invoiceNumber,
      amount: params.amount,
      currency: params.currency,
      dueDate: params.dueDate,
      daysOverdue: String(params.daysOverdue),
      senderName: params.senderName,
      companyName: params.companyName,
    },
  });
}

/**
 * Send payment confirmation
 */
export async function notifyPaymentReceived(params: {
  buyerEmail: string;
  buyerName: string;
  invoiceNumber: string;
  amount: string;
  currency: string;
  companyName: string;
}): Promise<string | null> {
  if (!isEmailConfigured()) return null;

  return queueTemplateEmail({
    to: params.buyerEmail,
    template: 'payment_received',
    variables: {
      contactName: params.buyerName,
      invoiceNumber: params.invoiceNumber,
      amount: params.amount,
      currency: params.currency,
      companyName: params.companyName,
    },
  });
}
