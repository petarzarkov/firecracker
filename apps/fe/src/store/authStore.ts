import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { UserRole } from '@/types';

export interface User {
  id: string;
  email: string;
  displayName?: string | null;
  picture?: string | null;
  roles: UserRole[];
  isDemo?: boolean;
}

interface AuthState {
  /**
   * The bearer token, when there is one.
   *
   * `null` after a social sign-in, and that is not a broken state: the session
   * lives in an `HttpOnly` cookie and the app is same-origin, so every request and
   * the WebSocket upgrade authenticate without it. What the token buys is the
   * socket's `?token=` fallback, which only a cross-origin client needs.
   *
   * `isAuthenticated` is therefore the flag to branch on, never `token`.
   */
  token: string | null;
  user: User | null;
  setAuth: (token: string | null, user: User) => void;
  updateUser: (updates: Partial<User>) => void;
  clearAuth: () => void;
  isAuthenticated: boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, _get) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      setAuth: (token, user) => {
        set({ token, user, isAuthenticated: true });
      },
      updateUser: (updates: Partial<User>) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        }));
      },
      clearAuth: () => {
        set({ token: null, user: null, isAuthenticated: false });
      },
    }),
    {
      name: 'auth-storage',
    },
  ),
);
