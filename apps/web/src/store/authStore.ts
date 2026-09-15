import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'FOUNDER' | 'SALES' | 'OPERATIONS' | 'FINANCE' | 'ADMIN';
}

/**
 * SECURITY NOTE: Token Storage Strategy
 * 
 * Tokens are currently stored in localStorage via Zustand's persist middleware.
 * This makes them accessible to JavaScript and theoretically vulnerable to XSS.
 * 
 * Mitigations in place:
 * 1. Short-lived access tokens (15 minutes) limit exposure window
 * 2. Refresh token rotation: each use generates a new token
 * 3. Token family tracking: reuse of an old token invalidates the entire family
 * 4. Helmet security headers including Content-Security-Policy
 * 5. All user input is escaped via React's default behavior
 * 
 * Alternative: HttpOnly cookies would prevent JavaScript access but require:
 * - Backend cookie-setting logic with SameSite/Secure flags
 * - CSRF protection (tokens or double-submit cookies)
 * - Changes to CORS configuration
 * 
 * The current approach is acceptable for internal business applications where:
 * - Users are trusted employees
 * - The attack surface is limited (not a public-facing app)
 * - The refresh token rotation provides theft detection
 * 
 * For higher-security deployments, consider migrating to HttpOnly cookies.
 */
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
