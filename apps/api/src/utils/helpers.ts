import { prisma } from '@seabridge/database';

/**
 * Generate sequential codes like BYR-00001, INQ-00001, etc.
 *
 * CRITICAL: This uses a single atomic SQL statement with INSERT ... ON CONFLICT
 * and RETURNING. The previous Prisma upsert was NOT atomic — two concurrent
 * calls could read the same currentNo before either incremented it, producing
 * duplicate codes.
 *
 * The raw SQL guarantees:
 *  1. INSERT or UPDATE happens in one statement (no read-then-write race)
 *  2. RETURNING gives us the new value, not the old one
 *  3. PostgreSQL's row-level locking prevents concurrent duplicates
 */
export async function generateCode(entityType: string, prefix: string): Promise<string> {
  const result = await prisma.$queryRaw<
    { current_no: number; pad_length: number; prefix: string }[]
  >`
    INSERT INTO number_sequences (id, entity_type, prefix, current_no, pad_length, created_at, updated_at)
    VALUES (gen_random_uuid(), ${entityType}, ${prefix}, 1, 5, NOW(), NOW())
    ON CONFLICT (entity_type)
    DO UPDATE SET 
      current_no = number_sequences.current_no + 1,
      updated_at = NOW()
    RETURNING current_no, pad_length, prefix
  `;

  if (!result || result.length === 0) {
    throw new Error(`Failed to generate code for entity type: ${entityType}`);
  }

  const { current_no, pad_length, prefix: storedPrefix } = result[0];
  const paddedNo = String(current_no).padStart(pad_length, '0');
  return `${storedPrefix}-${paddedNo}`;
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
