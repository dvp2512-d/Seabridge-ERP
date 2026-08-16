import { prisma } from '@seabridge/database';

// Generate sequential codes like BYR-00001, INQ-00001, etc.
export async function generateCode(entityType: string, prefix: string): Promise<string> {
  const sequence = await prisma.numberSequence.upsert({
    where: { entityType },
    create: {
      entityType,
      prefix,
      currentNo: 1,
      padLength: 5,
    },
    update: {
      currentNo: { increment: 1 },
    },
  });

  const paddedNo = String(sequence.currentNo).padStart(sequence.padLength, '0');
  return `${sequence.prefix}-${paddedNo}`;
}

// Format currency
export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

// Calculate margin percentage
export function calculateMarginPercent(cost: number, price: number): number {
  if (price === 0) return 0;
  return Number((((price - cost) / price) * 100).toFixed(2));
}

// Parse decimal safely
export function parseDecimal(value: any): number {
  if (value === null || value === undefined) return 0;
  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? 0 : parsed;
}

// Pagination helper
export function getPagination(query: any) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 50));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// Build where clause for common filters
export function buildWhereClause(query: any, searchFields: string[]) {
  const where: any = {};

  if (query.search && searchFields.length > 0) {
    where.OR = searchFields.map(field => ({
      [field]: { contains: query.search, mode: 'insensitive' },
    }));
  }

  if (query.isActive !== undefined) {
    where.isActive = query.isActive === 'true';
  }

  return where;
}
