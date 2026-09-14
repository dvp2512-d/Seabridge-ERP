/**
 * Activity Timeline Service
 * 
 * Provides chronological activity history for any record.
 * Pulls from audit log and related records to build a complete timeline.
 */
import { prisma } from '@seabridge/database';
import dayjs from 'dayjs';

export interface TimelineEvent {
  id: string;
  timestamp: Date;
  action: string;
  description: string;
  user?: {
    id: string;
    name: string;
  };
  metadata?: Record<string, any>;
}

/**
 * Get activity timeline for a buyer
 */
export async function getBuyerTimeline(buyerId: string): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  // Get audit log entries for this buyer
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: 'BUYERS', entityId: buyerId },
        { entityType: 'BUYER_CONTACTS', newValues: { path: ['buyerId'], equals: buyerId } },
        { entityType: 'COMMUNICATIONS', newValues: { path: ['buyerId'], equals: buyerId } },
      ],
    },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  auditLogs.forEach(log => {
    events.push({
      id: log.id,
      timestamp: log.createdAt,
      action: log.action,
      description: formatAuditDescription(log.action, log.entityType),
      user: log.user ? { id: log.user.id, name: `${log.user.firstName} ${log.user.lastName}` } : undefined,
    });
  });

  // Get related inquiries
  const inquiries = await prisma.inquiry.findMany({
    where: { buyerId },
    select: { id: true, inquiryNumber: true, createdAt: true, stage: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  inquiries.forEach(inq => {
    events.push({
      id: `inquiry-${inq.id}`,
      timestamp: inq.createdAt,
      action: 'INQUIRY_CREATED',
      description: `Inquiry ${inq.inquiryNumber} created`,
    });
  });

  // Get related orders
  const orders = await prisma.exportOrder.findMany({
    where: { buyerId },
    select: { id: true, orderNumber: true, createdAt: true, status: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  orders.forEach(ord => {
    events.push({
      id: `order-${ord.id}`,
      timestamp: ord.createdAt,
      action: 'ORDER_CREATED',
      description: `Order ${ord.orderNumber} placed`,
    });
  });

  // Sort by timestamp descending
  events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return events.slice(0, 50);
}

/**
 * Get activity timeline for an order
 */
export async function getOrderTimeline(orderId: string): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  // Get audit logs
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: 'ORDERS', entityId: orderId },
        { entityType: 'PROCUREMENTS', newValues: { path: ['orderId'], equals: orderId } },
        { entityType: 'SHIPMENTS', newValues: { path: ['orderId'], equals: orderId } },
        { entityType: 'DOCUMENTS', newValues: { path: ['orderId'], equals: orderId } },
      ],
    },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  auditLogs.forEach(log => {
    events.push({
      id: log.id,
      timestamp: log.createdAt,
      action: log.action,
      description: formatAuditDescription(log.action, log.entityType),
      user: log.user ? { id: log.user.id, name: `${log.user.firstName} ${log.user.lastName}` } : undefined,
    });
  });

  // Get procurements
  const procurements = await prisma.procurement.findMany({
    where: { orderId },
    select: { id: true, poNumber: true, createdAt: true, supplier: { select: { name: true } } },
  });

  procurements.forEach(proc => {
    events.push({
      id: `proc-${proc.id}`,
      timestamp: proc.createdAt,
      action: 'PROCUREMENT_CREATED',
      description: `PO ${proc.poNumber || proc.id.slice(0, 8)} raised for ${proc.supplier?.name || 'supplier'}`,
    });
  });

  // Get shipments
  const shipments = await prisma.shipment.findMany({
    where: { orderId },
    select: { id: true, createdAt: true, vesselName: true, status: true },
  });

  shipments.forEach(ship => {
    events.push({
      id: `ship-${ship.id}`,
      timestamp: ship.createdAt,
      action: 'SHIPMENT_CREATED',
      description: `Shipment created${ship.vesselName ? ` on ${ship.vesselName}` : ''}`,
    });
  });

  // Get invoices
  const invoices = await prisma.invoice.findMany({
    where: { orderId },
    select: { id: true, invoiceNumber: true, createdAt: true, type: true },
  });

  invoices.forEach(inv => {
    events.push({
      id: `inv-${inv.id}`,
      timestamp: inv.createdAt,
      action: 'INVOICE_CREATED',
      description: `${inv.type} invoice ${inv.invoiceNumber} created`,
    });
  });

  events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return events.slice(0, 50);
}

/**
 * Get activity timeline for an invoice
 */
export async function getInvoiceTimeline(invoiceId: string): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  // Get audit logs
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: 'INVOICES', entityId: invoiceId },
        { entityType: 'PAYMENTS', newValues: { path: ['invoiceId'], equals: invoiceId } },
      ],
    },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  auditLogs.forEach(log => {
    events.push({
      id: log.id,
      timestamp: log.createdAt,
      action: log.action,
      description: formatAuditDescription(log.action, log.entityType),
      user: log.user ? { id: log.user.id, name: `${log.user.firstName} ${log.user.lastName}` } : undefined,
    });
  });

  // Get payments
  const payments = await prisma.payment.findMany({
    where: { invoiceId },
    select: { id: true, paymentNumber: true, amount: true, paymentDate: true },
    orderBy: { paymentDate: 'desc' },
  });

  payments.forEach(pay => {
    events.push({
      id: `pay-${pay.id}`,
      timestamp: pay.paymentDate,
      action: 'PAYMENT_RECEIVED',
      description: `Payment ${pay.paymentNumber} received: ${Number(pay.amount).toLocaleString()}`,
    });
  });

  events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return events.slice(0, 50);
}

/**
 * Generic timeline for any entity
 */
export async function getEntityTimeline(entityType: string, entityId: string): Promise<TimelineEvent[]> {
  const auditLogs = await prisma.auditLog.findMany({
    where: { entityType: entityType.toUpperCase(), entityId },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return auditLogs.map(log => ({
    id: log.id,
    timestamp: log.createdAt,
    action: log.action,
    description: formatAuditDescription(log.action, log.entityType),
    user: log.user ? { id: log.user.id, name: `${log.user.firstName} ${log.user.lastName}` } : undefined,
  }));
}

/**
 * Format audit log action to human-readable description
 */
function formatAuditDescription(action: string, entityType: string): string {
  const entityName = entityType.toLowerCase().replace(/_/g, ' ').replace(/s$/, '');
  
  switch (action) {
    case 'CREATE':
      return `${entityName} created`;
    case 'UPDATE':
      return `${entityName} updated`;
    case 'DELETE':
      return `${entityName} deleted`;
    case 'PERMANENT_DELETE':
      return `${entityName} permanently deleted`;
    default:
      return `${action.toLowerCase()} on ${entityName}`;
  }
}
