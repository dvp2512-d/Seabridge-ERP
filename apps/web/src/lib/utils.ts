import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import dayjs from 'dayjs';

// Merge Tailwind classes
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The currency every stored amount is denominated in.
 *
 * Exported so screens do not scatter the literal 'INR' around, and so the one
 * place it is defined is obvious if the base currency ever changes. A document's
 * presentation currency is a separate thing entirely - see Quotation.pdfCurrency.
 */
export const BASE_CURRENCY_CODE = 'INR';

// Format currency.
//
// Every amount stored in this system is INR, so that is the default: passing no
// code yields rupees rather than dollars. A code is only supplied where a figure
// is genuinely being presented in another currency, which happens on generated
// documents and in the dialog that previews them.
//
// Guards against invalid/empty currency codes, which would otherwise make
// Intl.NumberFormat throw a RangeError and blank out the whole page.
export function formatCurrency(
  amount: number | string | null | undefined,
  currency?: string | null
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  const safeAmount = Number.isFinite(num as number) ? (num as number) : 0;
  const code = (currency || 'INR').toUpperCase();

  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(safeAmount);
  } catch {
    // Unknown code - still show the number rather than breaking the page.
    return `${code} ${safeAmount.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

// Format date
export function formatDate(date: string | Date, format: string = 'DD MMM YYYY'): string {
  if (!date) return '-';
  return dayjs(date).format(format);
}

// Format datetime
export function formatDateTime(date: string | Date): string {
  if (!date) return '-';
  return dayjs(date).format('DD MMM YYYY, HH:mm');
}

/**
 * True only when `date` is a real date in the past.
 *
 * Important: `new Date(null)` evaluates to 1970-01-01, so a naive
 * `new Date(value) < new Date()` check reports records with no date at all as
 * overdue. Always route overdue checks through here.
 */
export function isPastDue(date: string | Date | null | undefined): boolean {
  if (!date) return false;
  const d = dayjs(date);
  if (!d.isValid()) return false;
  return d.endOf('day').isBefore(dayjs());
}

// Get status color
export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    // Inquiry stages
    NEW: 'badge-info',
    REQUIREMENT_GATHERED: 'badge-info',
    PRICING_IN_PROGRESS: 'badge-warning',
    QUOTATION_SENT: 'badge-warning',
    NEGOTIATION: 'badge-gold',
    WON: 'badge-success',
    LOST: 'badge-danger',
    ON_HOLD: 'badge-gray',
    
    // Quotation status
    DRAFT: 'badge-gray',
    SENT: 'badge-info',
    REVISED: 'badge-warning',
    ACCEPTED: 'badge-success',
    REJECTED: 'badge-danger',
    EXPIRED: 'badge-gray',
    
    // Order status
    CONFIRMED: 'badge-info',
    IN_PRODUCTION: 'badge-warning',
    READY_TO_SHIP: 'badge-gold',
    SHIPPED: 'badge-info',
    DELIVERED: 'badge-success',
    CANCELLED: 'badge-danger',
    
    // Invoice status
    PARTIALLY_PAID: 'badge-warning',
    PAID: 'badge-success',
    OVERDUE: 'badge-danger',
    
    // Buyer status
    LEAD: 'badge-gray',
    PROSPECT: 'badge-info',
    ACTIVE: 'badge-success',
    INACTIVE: 'badge-gray',
    CHURNED: 'badge-danger',
    
    // Task/Document status
    PENDING: 'badge-warning',
    IN_PROGRESS: 'badge-info',
    COMPLETED: 'badge-success',
  };
  
  return colors[status] || 'badge-gray';
}

// Get priority color
export function getPriorityColor(priority: string): string {
  const colors: Record<string, string> = {
    LOW: 'badge-gray',
    MEDIUM: 'badge-info',
    HIGH: 'badge-warning',
    URGENT: 'badge-danger',
  };
  return colors[priority] || 'badge-gray';
}

// Download file
export function downloadFile(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

// Generate initials from name
export function getInitials(firstName?: string, lastName?: string): string {
  const f = firstName?.[0] || '';
  const l = lastName?.[0] || '';
  return (f + l).toUpperCase() || '?';
}
