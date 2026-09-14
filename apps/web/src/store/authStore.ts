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
  refreshToken: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: User, refreshToken?: string) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      
      login: (token, user, refreshToken) => {
        set({ token, user, refreshToken: refreshToken || null, isAuthenticated: true });
      },
      
      logout: () => {
        set({ token: null, refreshToken: null, user: null, isAuthenticated: false });
      },
      
      updateUser: (updates) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        }));
      },

      setTokens: (accessToken, refreshToken) => {
        set({ token: accessToken, refreshToken });
      },
    }),
    {
      name: 'seabridge-auth',
      partialize: (state) => ({ 
        token: state.token, 
        refreshToken: state.refreshToken,
        user: state.user, 
        isAuthenticated: state.isAuthenticated 
      }),
    }
  )
);
