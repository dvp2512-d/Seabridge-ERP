import { prisma, Prisma } from '@seabridge/database';

/**
 * Get the current Indian financial year in FY format (e.g., "2425" for April 2024 - March 2025).
 * Indian FY runs April 1 to March 31.
 */
function getCurrentFY(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed, so March = 2
  
  // If before April, we're in the previous FY
  const fyStart = month < 3 ? year - 1 : year;
  const fyEnd = fyStart + 1;
  
  // Return last 2 digits of each year: 2024-2025 → "2425"
  return `${String(fyStart).slice(-2)}${String(fyEnd).slice(-2)}`;
}

/**
 * Prisma transaction client type for transaction-aware functions.
 */
type PrismaClient = typeof prisma;
type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Generate sequential codes like BYR-00001, INQ-00001, etc.
 * 
 * Uses atomic upsert to prevent race conditions between concurrent requests.
 * 
 * For gap-free sequences, use generateCodeInTx() within a transaction.
 * 
 * @param entityType - Unique identifier for the sequence (e.g., 'INVOICE', 'ORDER')
 * @param prefix - Prefix for the generated code (e.g., 'INV', 'ORD')
 * @param options.useFY - If true, includes financial year in the code (e.g., INV-2425-00001)
 * @param options.resetOnFY - If true combined with useFY, resets counter at FY start
 */
export async function generateCode(
  entityType: string, 
  prefix: string,
  options?: { useFY?: boolean; resetOnFY?: boolean }
): Promise<string> {
  return generateCodeWithClient(prisma, entityType, prefix, options);
}

/**
 * Generate sequential codes within a transaction.
 * 
 * This version accepts a transaction client, ensuring the sequence increment
 * and record creation are atomic. If the parent transaction rolls back, the
 * sequence number is not consumed, preventing gaps.
 * 
 * @param tx - Prisma transaction client
 * @param entityType - Unique identifier for the sequence
 * @param prefix - Prefix for the generated code
 * @param options - Optional FY settings
 */
export async function generateCodeInTx(
  tx: TransactionClient,
  entityType: string, 
  prefix: string,
  options?: { useFY?: boolean; resetOnFY?: boolean }
): Promise<string> {
  return generateCodeWithClient(tx, entityType, prefix, options);
}

/**
 * Internal implementation that works with any Prisma client (main or transaction).
 */
async function generateCodeWithClient(
  client: PrismaClient | TransactionClient,
  entityType: string,
  prefix: string,
  options?: { useFY?: boolean; resetOnFY?: boolean }
): Promise<string> {
  const { useFY = false, resetOnFY = false } = options || {};
  
  // For FY-aware sequences, include FY in the entityType to get per-FY counters
  const fy = useFY ? getCurrentFY() : null;
  const sequenceKey = resetOnFY && fy ? `${entityType}_FY${fy}` : entityType;
  
  const sequence = await client.numberSequence.upsert({
    where: { entityType: sequenceKey },
    create: {
      entityType: sequenceKey,
      prefix,
      currentNo: 1,
      padLength: 5,
    },
    update: {
      currentNo: { increment: 1 },
    },
  });

  const paddedNo = String(sequence.currentNo).padStart(sequence.padLength, '0');
  
  // Include FY in the code if requested: INV-2425-00001
  if (useFY && fy) {
    return `${sequence.prefix}-${fy}-${paddedNo}`;
  }
  
  return `${sequence.prefix}-${paddedNo}`;
}

// Calculate margin percentage
export function calculateMarginPercent(cost: number, price: number): number {
  if (price === 0) return 0;
  return Number((((price - cost) / price) * 100).toFixed(2));
}

/**
 * Sanitize a filename for use in Content-Disposition headers.
 *
 * Prevents header injection attacks by:
 * 1. Removing newlines and carriage returns (header injection)
 * 2. Removing/escaping quotes and backslashes
 * 3. Replacing path separators
 * 4. Limiting to safe ASCII characters for maximum compatibility
 *
 * For non-ASCII filenames, uses RFC 5987 encoding (filename*=UTF-8'').
 */
export function sanitizeFilename(filename: string): string {
  // Remove any path components - take only the filename
  const basename = filename.replace(/^.*[\\/]/, '');
  
  // Remove characters that could cause header injection or parsing issues
  // This includes: newlines, carriage returns, quotes, backslashes, and control chars
  const sanitized = basename
    .replace(/[\r\n]/g, '')           // Remove newlines (header injection)
    .replace(/"/g, "'")               // Replace double quotes with single
    .replace(/\\/g, '_')              // Replace backslashes
    .replace(/[<>:"|?*]/g, '_')       // Replace Windows-illegal chars
    .replace(/[\x00-\x1f\x7f]/g, ''); // Remove control characters
  
  // Limit length to prevent issues
  const maxLength = 200;
  if (sanitized.length > maxLength) {
    const ext = sanitized.lastIndexOf('.');
    if (ext > 0) {
      const extension = sanitized.slice(ext);
      const name = sanitized.slice(0, maxLength - extension.length);
      return name + extension;
    }
    return sanitized.slice(0, maxLength);
  }
  
  return sanitized || 'download';
}

/**
 * Build a safe Content-Disposition header value.
 * Handles both ASCII and non-ASCII filenames per RFC 5987.
 */
export function contentDisposition(filename: string, type: 'attachment' | 'inline' = 'attachment'): string {
  const safe = sanitizeFilename(filename);
  
  // Check if filename is pure ASCII
  const isAscii = /^[\x20-\x7E]*$/.test(safe);
  
  if (isAscii) {
    // Simple case: ASCII-only filename
    return `${type}; filename="${safe}"`;
  }
  
  // Non-ASCII: use RFC 5987 encoding with fallback
  const encoded = encodeURIComponent(safe).replace(/'/g, '%27');
  const asciiFallback = safe.replace(/[^\x20-\x7E]/g, '_');
  
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
