/**
 * Data Export Service
 * 
 * Provides export functionality for various modules in CSV and JSON formats.
 * Excel support can be added by installing xlsx package.
 * 
 * Supports:
 * - Invoices export with payment status
 * - Orders export with status and values
 * - Buyers export with contact details
 * - Expenses export with payment tracking
 * - Receivables report export
 */
import { prisma } from '@seabridge/database';
import dayjs from 'dayjs';
import { logger } from '../utils/logger';

// Date range filter helper
interface DateRange {
  from?: Date;
  to?: Date;
}

function buildDateFilter(dateRange: DateRange, field: string) {
  if (!dateRange.from && !dateRange.to) return {};
  
  const filter: any = {};
  if (dateRange.from) filter.gte = dateRange.from;
  if (dateRange.to) filter.lte = dateRange.to;
  
  return { [field]: filter };
}

/**
 * Convert array of objects to CSV string
 */
export function toCSV(data: Record<string, any>[], columns?: { key: string; header: string }[]): string {
  if (data.length === 0) return '';

  // Auto-detect columns if not provided
  const cols = columns || Object.keys(data[0]).map(key => ({ key, header: key }));
  
  // Header row
  const headerRow = cols.map(c => `"${c.header}"`).join(',');
  
  // Data rows
  const dataRows = data.map(row => {
    return cols.map(c => {
      const value = row[c.key];
      if (value === null || value === undefined) return '""';
      if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
      if (value instanceof Date) return `"${dayjs(value).format('YYYY-MM-DD HH:mm:ss')}"`;
      return `"${String(value)}"`;
    }).join(',');
  });

  return [headerRow, ...dataRows].join('\n');
}

/**
 * Export invoices to CSV
 */
export async function exportInvoices(params: {
  status?: string;
  buyerId?: string;
  dateRange?: DateRange;
}): Promise<{ csv: string; count: number }> {
  const where: any = {};
  if (params.status) where.status = params.status;
  if (params.buyerId) where.buyerId = params.buyerId;
  if (params.dateRange) Object.assign(where, buildDateFilter(params.dateRange, 'invoiceDate'));

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      buyer: { select: { companyName: true } },
      order: { select: { orderNumber: true } },
    },
    orderBy: { invoiceDate: 'desc' },
  });

  const data = invoices.map(inv => ({
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: dayjs(inv.invoiceDate).format('YYYY-MM-DD'),
    buyer: inv.buyer.companyName,
    orderNumber: inv.order?.orderNumber || '',
    type: inv.type,
    status: inv.status,
    currency: inv.pdfCurrency || 'INR',
    totalAmount: Number(inv.totalAmount),
    paidAmount: Number(inv.paidAmount),
    balanceAmount: Number(inv.balanceAmount),
    dueDate: inv.dueDate ? dayjs(inv.dueDate).format('YYYY-MM-DD') : '',
  }));

  const columns = [
    { key: 'invoiceNumber', header: 'Invoice Number' },
    { key: 'invoiceDate', header: 'Invoice Date' },
    { key: 'buyer', header: 'Buyer' },
    { key: 'orderNumber', header: 'Order Number' },
    { key: 'type', header: 'Type' },
    { key: 'status', header: 'Status' },
    { key: 'currency', header: 'Currency' },
    { key: 'totalAmount', header: 'Total Amount' },
    { key: 'paidAmount', header: 'Paid Amount' },
    { key: 'balanceAmount', header: 'Balance Amount' },
    { key: 'dueDate', header: 'Due Date' },
  ];

  logger.info('Exported invoices', { count: data.length });
  return { csv: toCSV(data, columns), count: data.length };
}

/**
 * Export orders to CSV
 */
export async function exportOrders(params: {
  status?: string;
  buyerId?: string;
  dateRange?: DateRange;
}): Promise<{ csv: string; count: number }> {
  const where: any = {};
  if (params.status) where.status = params.status;
  if (params.buyerId) where.buyerId = params.buyerId;
  if (params.dateRange) Object.assign(where, buildDateFilter(params.dateRange, 'orderDate'));

  const orders = await prisma.exportOrder.findMany({
    where,
    include: {
      buyer: { select: { companyName: true } },
      quotation: { select: { quotationNumber: true } },
      incoterm: { select: { code: true } },
      items: true,
      shipments: { select: { id: true, status: true } },
    },
    orderBy: { orderDate: 'desc' },
  });

  const data = orders.map(order => ({
    orderNumber: order.orderNumber,
    orderDate: dayjs(order.orderDate).format('YYYY-MM-DD'),
    buyer: order.buyer.companyName,
    quotationNumber: order.quotation?.quotationNumber || '',
    status: order.status,
    totalValue: Number(order.totalValue),
    currency: 'INR',
    incoterm: order.incoterm?.code || '',
    itemCount: order.items.length,
    shipmentCount: order.shipments.length,
    expectedDate: order.expectedDate ? dayjs(order.expectedDate).format('YYYY-MM-DD') : '',
  }));

  const columns = [
    { key: 'orderNumber', header: 'Order Number' },
    { key: 'orderDate', header: 'Order Date' },
    { key: 'buyer', header: 'Buyer' },
    { key: 'quotationNumber', header: 'Quotation' },
    { key: 'status', header: 'Status' },
    { key: 'totalValue', header: 'Total Value (INR)' },
    { key: 'currency', header: 'Currency' },
    { key: 'incoterm', header: 'Incoterm' },
    { key: 'itemCount', header: 'Items' },
    { key: 'shipmentCount', header: 'Shipments' },
    { key: 'expectedDate', header: 'Expected Date' },
  ];

  logger.info('Exported orders', { count: data.length });
  return { csv: toCSV(data, columns), count: data.length };
}

/**
 * Export buyers to CSV
 */
export async function exportBuyers(params: {
  status?: string;
}): Promise<{ csv: string; count: number }> {
  const where: any = {};
  if (params.status) where.status = params.status;

  const buyers = await prisma.buyer.findMany({
    where,
    include: {
      country: { select: { name: true } },
      currency: { select: { code: true } },
      contacts: { where: { isPrimary: true }, take: 1 },
      _count: { select: { orders: true, invoices: true } },
    },
    orderBy: { companyName: 'asc' },
  });

  const data = buyers.map(buyer => ({
    code: buyer.code,
    companyName: buyer.companyName,
    status: buyer.status,
    country: buyer.country?.name || '',
    currency: buyer.currency?.code || '',
    contactName: buyer.contacts[0] ? `${buyer.contacts[0].firstName} ${buyer.contacts[0].lastName || ''}`.trim() : '',
    contactEmail: buyer.contacts[0]?.email || '',
    contactPhone: buyer.contacts[0]?.phone || '',
    paymentTerms: buyer.paymentTerms || '',
    creditDays: buyer.creditDays || 0,
    totalOrders: buyer._count.orders,
    totalInvoices: buyer._count.invoices,
    createdAt: dayjs(buyer.createdAt).format('YYYY-MM-DD'),
  }));

  const columns = [
    { key: 'code', header: 'Code' },
    { key: 'companyName', header: 'Company Name' },
    { key: 'status', header: 'Status' },
    { key: 'country', header: 'Country' },
    { key: 'currency', header: 'Currency' },
    { key: 'contactName', header: 'Primary Contact' },
    { key: 'contactEmail', header: 'Email' },
    { key: 'contactPhone', header: 'Phone' },
    { key: 'paymentTerms', header: 'Payment Terms' },
    { key: 'creditDays', header: 'Credit Days' },
    { key: 'totalOrders', header: 'Total Orders' },
    { key: 'totalInvoices', header: 'Total Invoices' },
    { key: 'createdAt', header: 'Created Date' },
  ];

  logger.info('Exported buyers', { count: data.length });
  return { csv: toCSV(data, columns), count: data.length };
}

/**
 * Export expenses to CSV
 */
export async function exportExpenses(params: {
  status?: string;
  category?: string;
  dateRange?: DateRange;
}): Promise<{ csv: string; count: number }> {
  const where: any = {};
  if (params.status) where.status = params.status;
  if (params.category) where.category = params.category;
  if (params.dateRange) Object.assign(where, buildDateFilter(params.dateRange, 'expenseDate'));

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { expenseDate: 'desc' },
  });

  const data = expenses.map(exp => ({
    expenseNumber: exp.expenseNumber,
    expenseDate: dayjs(exp.expenseDate).format('YYYY-MM-DD'),
    category: exp.category,
    description: exp.description,
    vendorName: exp.vendorName || '',
    invoiceRef: exp.invoiceRef || '',
    amount: Number(exp.amount),
    paidAmount: Number(exp.paidAmount),
    balanceAmount: Number(exp.balanceAmount),
    status: exp.status,
    sourceType: exp.sourceType,
  }));

  const columns = [
    { key: 'expenseNumber', header: 'Expense Number' },
    { key: 'expenseDate', header: 'Date' },
    { key: 'category', header: 'Category' },
    { key: 'description', header: 'Description' },
    { key: 'vendorName', header: 'Vendor' },
    { key: 'invoiceRef', header: 'Invoice Ref' },
    { key: 'amount', header: 'Amount' },
    { key: 'paidAmount', header: 'Paid' },
    { key: 'balanceAmount', header: 'Balance' },
    { key: 'status', header: 'Status' },
    { key: 'sourceType', header: 'Source' },
  ];

  logger.info('Exported expenses', { count: data.length });
  return { csv: toCSV(data, columns), count: data.length };
}

/**
 * Export receivables report to CSV
 */
export async function exportReceivables(): Promise<{ csv: string; count: number }> {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ['SENT', 'PARTIALLY_PAID'] },
      type: 'COMMERCIAL',
    },
    include: {
      buyer: { select: { companyName: true, code: true } },
      order: { select: { orderNumber: true } },
    },
    orderBy: { dueDate: 'asc' },
  });

  const today = new Date();
  const data = invoices.map(inv => {
    const dueDate = inv.dueDate || inv.invoiceDate;
    const daysOverdue = dayjs(today).diff(dayjs(dueDate), 'day');
    
    let agingBucket = 'Current';
    if (daysOverdue > 0 && daysOverdue <= 30) agingBucket = '1-30 Days';
    else if (daysOverdue > 30 && daysOverdue <= 60) agingBucket = '31-60 Days';
    else if (daysOverdue > 60 && daysOverdue <= 90) agingBucket = '61-90 Days';
    else if (daysOverdue > 90) agingBucket = '90+ Days';

    return {
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: dayjs(inv.invoiceDate).format('YYYY-MM-DD'),
      buyerCode: inv.buyer.code,
      buyer: inv.buyer.companyName,
      orderNumber: inv.order?.orderNumber || '',
      currency: inv.pdfCurrency || 'INR',
      totalAmount: Number(inv.totalAmount),
      paidAmount: Number(inv.paidAmount),
      balanceAmount: Number(inv.balanceAmount),
      dueDate: dayjs(dueDate).format('YYYY-MM-DD'),
      daysOverdue: Math.max(0, daysOverdue),
      agingBucket,
    };
  });

  const columns = [
    { key: 'invoiceNumber', header: 'Invoice Number' },
    { key: 'invoiceDate', header: 'Invoice Date' },
    { key: 'buyerCode', header: 'Buyer Code' },
    { key: 'buyer', header: 'Buyer Name' },
    { key: 'orderNumber', header: 'Order Number' },
    { key: 'currency', header: 'Currency' },
    { key: 'totalAmount', header: 'Total Amount' },
    { key: 'paidAmount', header: 'Paid Amount' },
    { key: 'balanceAmount', header: 'Balance Amount' },
    { key: 'dueDate', header: 'Due Date' },
    { key: 'daysOverdue', header: 'Days Overdue' },
    { key: 'agingBucket', header: 'Aging Bucket' },
  ];

  logger.info('Exported receivables', { count: data.length });
  return { csv: toCSV(data, columns), count: data.length };
}

/**
 * Export quotations to CSV
 */
export async function exportQuotations(params: {
  status?: string;
  buyerId?: string;
  dateRange?: DateRange;
}): Promise<{ csv: string; count: number }> {
  const where: any = {};
  if (params.status) where.status = params.status;
  if (params.buyerId) where.buyerId = params.buyerId;
  if (params.dateRange) Object.assign(where, buildDateFilter(params.dateRange, 'createdAt'));

  const quotations = await prisma.quotation.findMany({
    where,
    include: {
      buyer: { select: { companyName: true } },
      inquiry: { select: { inquiryNumber: true } },
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const data = quotations.map(qt => ({
    quotationNumber: qt.quotationNumber,
    createdAt: dayjs(qt.createdAt).format('YYYY-MM-DD'),
    buyer: qt.buyer.companyName,
    inquiryNumber: qt.inquiry?.inquiryNumber || '',
    status: qt.status,
    currency: qt.pdfCurrency || 'INR',
    subtotal: Number(qt.subtotal),
    totalCost: Number(qt.totalCost),
    totalMargin: Number(qt.totalMargin),
    grandTotal: Number(qt.grandTotal),
    marginPercent: qt.subtotal ? ((Number(qt.totalMargin) / Number(qt.subtotal)) * 100).toFixed(2) : '0',
    validUntil: qt.validUntil ? dayjs(qt.validUntil).format('YYYY-MM-DD') : '',
    itemCount: qt.items.length,
  }));

  const columns = [
    { key: 'quotationNumber', header: 'Quotation Number' },
    { key: 'createdAt', header: 'Date' },
    { key: 'buyer', header: 'Buyer' },
    { key: 'inquiryNumber', header: 'Inquiry' },
    { key: 'status', header: 'Status' },
    { key: 'currency', header: 'Currency' },
    { key: 'subtotal', header: 'Subtotal' },
    { key: 'totalCost', header: 'Total Cost' },
    { key: 'totalMargin', header: 'Margin' },
    { key: 'marginPercent', header: 'Margin %' },
    { key: 'grandTotal', header: 'Grand Total' },
    { key: 'validUntil', header: 'Valid Until' },
    { key: 'itemCount', header: 'Items' },
  ];

  logger.info('Exported quotations', { count: data.length });
  return { csv: toCSV(data, columns), count: data.length };
}

/**
 * Export audit log to CSV (for compliance)
 */
export async function exportAuditLog(params: {
  entityType?: string;
  action?: string;
  userId?: string;
  dateRange?: DateRange;
}): Promise<{ csv: string; count: number }> {
  const where: any = {};
  if (params.entityType) where.entityType = params.entityType;
  if (params.action) where.action = params.action;
  if (params.userId) where.userId = params.userId;
  if (params.dateRange) Object.assign(where, buildDateFilter(params.dateRange, 'createdAt'));

  const logs = await prisma.auditLog.findMany({
    where,
    include: {
      user: { select: { email: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10000, // Limit for safety
  });

  const data = logs.map(log => ({
    timestamp: dayjs(log.createdAt).format('YYYY-MM-DD HH:mm:ss'),
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    user: log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System',
    userEmail: log.user?.email || '',
    ipAddress: log.ipAddress || '',
  }));

  const columns = [
    { key: 'timestamp', header: 'Timestamp' },
    { key: 'action', header: 'Action' },
    { key: 'entityType', header: 'Entity Type' },
    { key: 'entityId', header: 'Entity ID' },
    { key: 'user', header: 'User' },
    { key: 'userEmail', header: 'User Email' },
    { key: 'ipAddress', header: 'IP Address' },
  ];

  logger.info('Exported audit log', { count: data.length });
  return { csv: toCSV(data, columns), count: data.length };
}
