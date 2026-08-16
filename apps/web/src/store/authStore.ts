import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'FOUNDER' | 'SALES' | 'OPERATIONS' | 'FINANCE' | 'ADMIN';
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      
      login: (token, user) => {
        set({ token, user, isAuthenticated: true });
      },
      
      logout: () => {
        set({ token: null, user: null, isAuthenticated: false });
      },
      
      updateUser: (updates) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        }));
      },
    }),
    {
      name: 'seabridge-auth',
      partialize: (state) => ({ token: state.token, user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);

// Role-based permission helpers
export const canAccess = (userRole: string, requiredRoles: string[]) => {
  return requiredRoles.includes(userRole);
};

export const ROLE_PERMISSIONS = {
  FOUNDER: ['*'], // Full access
  ADMIN: ['*'],
  SALES: ['dashboard:sales', 'buyers', 'inquiries', 'quotations', 'products'],
  OPERATIONS: ['dashboard:operations', 'orders', 'shipments', 'documents', 'buyers:view'],
  FINANCE: ['dashboard:finance', 'invoices', 'payments', 'buyers:view', 'orders:view'],
};
