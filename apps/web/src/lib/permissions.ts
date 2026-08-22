import type { User } from '@/store/authStore';

export type Role = User['role'];

/**
 * Mirrors the PERMISSIONS matrix in apps/api/src/middleware/auth.ts.
 *
 * Keeping a copy on the client lets us hide navigation and skip requests the
 * user isn't allowed to make, instead of showing them a menu item that fails
 * with a 403 when clicked. The API remains the actual enforcement point.
 */
export const PERMISSIONS: Record<string, Role[]> = {
  DASHBOARD_FULL: ['FOUNDER', 'ADMIN'],
  DASHBOARD_SALES: ['FOUNDER', 'ADMIN', 'SALES'],
  DASHBOARD_OPERATIONS: ['FOUNDER', 'ADMIN', 'OPERATIONS'],
  DASHBOARD_FINANCE: ['FOUNDER', 'ADMIN', 'FINANCE'],

  MASTER_MANAGE: ['FOUNDER', 'ADMIN'],
  MASTER_VIEW: ['FOUNDER', 'ADMIN', 'SALES', 'OPERATIONS', 'FINANCE'],

  BUYER_MANAGE: ['FOUNDER', 'ADMIN', 'SALES'],
  BUYER_VIEW: ['FOUNDER', 'ADMIN', 'SALES', 'OPERATIONS', 'FINANCE'],

  SALES_MANAGE: ['FOUNDER', 'ADMIN', 'SALES'],
  SALES_VIEW: ['FOUNDER', 'ADMIN', 'SALES', 'OPERATIONS'],

  OPERATIONS_MANAGE: ['FOUNDER', 'ADMIN', 'OPERATIONS'],
  OPERATIONS_VIEW: ['FOUNDER', 'ADMIN', 'SALES', 'OPERATIONS', 'FINANCE'],

  FINANCE_MANAGE: ['FOUNDER', 'ADMIN', 'FINANCE'],
  FINANCE_VIEW: ['FOUNDER', 'ADMIN', 'FINANCE'],

  USER_MANAGE: ['FOUNDER', 'ADMIN'],
  USER_VIEW: ['FOUNDER', 'ADMIN'],

  SETTINGS_MANAGE: ['FOUNDER', 'ADMIN'],
  SETTINGS_VIEW: ['FOUNDER', 'ADMIN', 'SALES', 'OPERATIONS', 'FINANCE'],
};

export type Permission = keyof typeof PERMISSIONS;

/** True when the given role is allowed the permission. */
export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return PERMISSIONS[permission]?.includes(role) ?? false;
}
