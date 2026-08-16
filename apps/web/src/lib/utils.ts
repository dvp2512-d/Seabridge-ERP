import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import dayjs from 'dayjs';

// Merge Tailwind classes
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format currency.
// Guards against invalid/empty currency codes, which would otherwise make
// Intl.NumberFormat throw a RangeError and blank out the whole page.
export function formatCurrency(
  amount: number | string | null | undefined,
  currency?: string | null
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  const safeAmount = Number.isFinite(num as number) ? (num as number) : 0;
  const code = (currency || 'USD').toUpperCase();

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    }).format(safeAmount);
  } catch {
    // Unknown code - still show the number rather than breaking the page.
    return `${code} ${safeAmount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

// Format number
export function formatNumber(num: number | string): string {
  const n = typeof num === 'string' ? parseFloat(num) : num;
  return new Intl.NumberFormat('en-US').format(n || 0);
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

// Format relative time
export function formatRelativeTime(date: string | Date): string {
  if (!date) return '-';
  const d = dayjs(date);
  const now = dayjs();
  const diffDays = now.diff(d, 'day');
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return d.format('DD MMM YYYY');
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

/** Number of days until `date` (negative when already past). */
export function daysUntil(date: string | Date | null | undefined): number | null {
  if (!date) return null;
  const d = dayjs(date);
  if (!d.isValid()) return null;
  return d.endOf('day').diff(dayjs(), 'day');
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

// Truncate text
export function truncate(text: string, length: number = 50): string {
  if (!text) return '';
  return text.length > length ? `${text.substring(0, length)}...` : text;
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

// Debounce function
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Generate initials from name
export function getInitials(firstName?: string, lastName?: string): string {
  const f = firstName?.[0] || '';
  const l = lastName?.[0] || '';
  return (f + l).toUpperCase() || '?';
}
