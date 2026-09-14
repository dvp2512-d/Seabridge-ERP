/**
 * Global Search Service
 * 
 * Provides unified search across all major modules.
 * Returns categorized results with relevance scoring.
 */
import { prisma } from '@seabridge/database';
import { logger } from '../utils/logger';

export interface SearchResult {
  id: string;
  type: 'buyer' | 'inquiry' | 'quotation' | 'order' | 'invoice' | 'product' | 'supplier';
  title: string;
  subtitle: string;
  code: string;
  status?: string;
  url: string;
}

export interface SearchResults {
  query: string;
  total: number;
  results: SearchResult[];
  categories: {
    buyers: number;
    inquiries: number;
    quotations: number;
    orders: number;
    invoices: number;
    products: number;
    suppliers: number;
  };
}

/**
 * Global search across all modules
 */
export async function globalSearch(
  query: string,
  options: {
    limit?: number;
    types?: string[];
  } = {}
): Promise<SearchResults> {
  const { limit = 20, types } = options;
  const searchTerm = query.trim();
  
  if (searchTerm.length < 2) {
    return {
      query: searchTerm,
      total: 0,
      results: [],
      categories: { buyers: 0, inquiries: 0, quotations: 0, orders: 0, invoices: 0, products: 0, suppliers: 0 },
    };
  }

  const searchPattern = `%${searchTerm}%`;
  const results: SearchResult[] = [];
  const categories = { buyers: 0, inquiries: 0, quotations: 0, orders: 0, invoices: 0, products: 0, suppliers: 0 };

  // Search in parallel for performance
  const searchPromises: Promise<void>[] = [];

  // Search Buyers
  if (!types || types.includes('buyer')) {
    searchPromises.push(
      prisma.buyer.findMany({
        where: {
          OR: [
            { companyName: { contains: searchTerm, mode: 'insensitive' } },
            { code: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        take: limit,
        select: { id: true, companyName: true, code: true, status: true, country: { select: { name: true } } },
      }).then(buyers => {
        categories.buyers = buyers.length;
        buyers.forEach(b => results.push({
          id: b.id,
          type: 'buyer',
          title: b.companyName,
          subtitle: b.country?.name || '',
          code: b.code,
          status: b.status,
          url: `/buyers/${b.id}`,
        }));
      })
    );
  }

  // Search Inquiries
  if (!types || types.includes('inquiry')) {
    searchPromises.push(
      prisma.inquiry.findMany({
        where: {
          OR: [
            { inquiryNumber: { contains: searchTerm, mode: 'insensitive' } },
            { buyer: { companyName: { contains: searchTerm, mode: 'insensitive' } } },
          ],
        },
        take: limit,
        select: { id: true, inquiryNumber: true, stage: true, buyer: { select: { companyName: true } } },
      }).then(inquiries => {
        categories.inquiries = inquiries.length;
        inquiries.forEach(i => results.push({
          id: i.id,
          type: 'inquiry',
          title: i.inquiryNumber,
          subtitle: i.buyer.companyName,
          code: i.inquiryNumber,
          status: i.stage,
          url: `/inquiries/${i.id}`,
        }));
      })
    );
  }

  // Search Quotations
  if (!types || types.includes('quotation')) {
    searchPromises.push(
      prisma.quotation.findMany({
        where: {
          OR: [
            { quotationNumber: { contains: searchTerm, mode: 'insensitive' } },
            { buyer: { companyName: { contains: searchTerm, mode: 'insensitive' } } },
          ],
        },
        take: limit,
        select: { id: true, quotationNumber: true, status: true, buyer: { select: { companyName: true } } },
      }).then(quotations => {
        categories.quotations = quotations.length;
        quotations.forEach(q => results.push({
          id: q.id,
          type: 'quotation',
          title: q.quotationNumber,
          subtitle: q.buyer.companyName,
          code: q.quotationNumber,
          status: q.status,
          url: `/quotations/${q.id}`,
        }));
      })
    );
  }

  // Search Orders
  if (!types || types.includes('order')) {
    searchPromises.push(
      prisma.exportOrder.findMany({
        where: {
          OR: [
            { orderNumber: { contains: searchTerm, mode: 'insensitive' } },
            { buyer: { companyName: { contains: searchTerm, mode: 'insensitive' } } },
          ],
        },
        take: limit,
        select: { id: true, orderNumber: true, status: true, buyer: { select: { companyName: true } } },
      }).then(orders => {
        categories.orders = orders.length;
        orders.forEach(o => results.push({
          id: o.id,
          type: 'order',
          title: o.orderNumber,
          subtitle: o.buyer.companyName,
          code: o.orderNumber,
          status: o.status,
          url: `/orders/${o.id}`,
        }));
      })
    );
  }

  // Search Invoices
  if (!types || types.includes('invoice')) {
    searchPromises.push(
      prisma.invoice.findMany({
        where: {
          OR: [
            { invoiceNumber: { contains: searchTerm, mode: 'insensitive' } },
            { buyer: { companyName: { contains: searchTerm, mode: 'insensitive' } } },
          ],
        },
        take: limit,
        select: { id: true, invoiceNumber: true, status: true, buyer: { select: { companyName: true } } },
      }).then(invoices => {
        categories.invoices = invoices.length;
        invoices.forEach(inv => results.push({
          id: inv.id,
          type: 'invoice',
          title: inv.invoiceNumber,
          subtitle: inv.buyer.companyName,
          code: inv.invoiceNumber,
          status: inv.status,
          url: `/invoices/${inv.id}`,
        }));
      })
    );
  }

  // Search Products
  if (!types || types.includes('product')) {
    searchPromises.push(
      prisma.product.findMany({
        where: {
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { code: { contains: searchTerm, mode: 'insensitive' } },
            { hsnCode: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        take: limit,
        select: { id: true, name: true, code: true, hsnCode: true, isActive: true },
      }).then(products => {
        categories.products = products.length;
        products.forEach(p => results.push({
          id: p.id,
          type: 'product',
          title: p.name,
          subtitle: p.hsnCode || '',
          code: p.code,
          status: p.isActive ? 'ACTIVE' : 'INACTIVE',
          url: `/products/${p.id}`,
        }));
      })
    );
  }

  // Search Suppliers
  if (!types || types.includes('supplier')) {
    searchPromises.push(
      prisma.supplier.findMany({
        where: {
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { code: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        take: limit,
        select: { id: true, name: true, code: true, isActive: true },
      }).then(suppliers => {
        categories.suppliers = suppliers.length;
        suppliers.forEach(s => results.push({
          id: s.id,
          type: 'supplier',
          title: s.name,
          subtitle: '',
          code: s.code,
          status: s.isActive ? 'ACTIVE' : 'INACTIVE',
          url: `/suppliers/${s.id}`,
        }));
      })
    );
  }

  await Promise.all(searchPromises);

  // Sort results: exact matches first, then by type priority
  const typePriority: Record<string, number> = {
    order: 1, invoice: 2, quotation: 3, inquiry: 4, buyer: 5, product: 6, supplier: 7,
  };

  results.sort((a, b) => {
    // Exact code match gets highest priority
    const aExact = a.code.toLowerCase() === searchTerm.toLowerCase() ? 0 : 1;
    const bExact = b.code.toLowerCase() === searchTerm.toLowerCase() ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    
    // Then sort by type priority
    return (typePriority[a.type] || 99) - (typePriority[b.type] || 99);
  });

  logger.info('Global search executed', { query: searchTerm, total: results.length });

  return {
    query: searchTerm,
    total: results.length,
    results: results.slice(0, limit),
    categories,
  };
}
