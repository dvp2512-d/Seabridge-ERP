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
