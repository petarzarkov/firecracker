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

/**
 * Whether two users are the same as far as this app is concerned.
 *
 * ## Why identity is worth this much care
 *
 * `user` is a dependency of the effect in `useWebSocket`, so **a new object with
 * identical contents tears the socket down and opens another one**. That is not
 * hypothetical - it shipped, and the loop was:
 *
 *   socket opens → server sends `connected` → `updateUser(payload)` → `set()`
 *   spreads a fresh object → `user` identity changes → the effect's cleanup runs
 *   → `disconnect()` → a new socket opens → …
 *
 * Twice a second, forever, visible as an endless run of `socket closed` at code
 * 1000 in the server log. `AuthMiddleware` re-writing the session every few
 * minutes did the same thing more slowly.
 *
 * Fixing it in the *store* rather than in each consumer's dependency array is
 * deliberate: a dependency list is a thing every future caller has to get right,
 * and this is one place that makes the whole class of bug impossible.
 */
const sameUser = (a: User | null, b: User | null): boolean => {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.id === b.id &&
    a.email === b.email &&
    a.displayName === b.displayName &&
    a.picture === b.picture &&
    a.isDemo === b.isDemo &&
    a.roles.length === b.roles.length &&
    a.roles.every((role, i) => role === b.roles[i])
  );
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,

      /**
       * Keeps the existing `user` object when the new one is equal, so a repeated
       * sign-in check does not invalidate every consumer that depends on it.
       */
      setAuth: (token, user) => {
        set((state) => ({
          token,
          user: sameUser(state.user, user) ? state.user : user,
          isAuthenticated: true,
        }));
      },

      updateUser: (updates: Partial<User>) => {
        set((state) => {
          if (state.user === null) return {};
          const next = { ...state.user, ...updates };
          // No change, no new object - see `sameUser`.
          return sameUser(state.user, next) ? {} : { user: next };
        });
      },

      clearAuth: () => {
        set({ token: null, user: null, isAuthenticated: false });
      },
    }),
    {
      name: 'auth-storage',
      /**
       * The user is persisted. **The token is not.**
       *
       * The session's real carrier is better-auth's `HttpOnly` cookie, which the
       * browser stores itself and JavaScript cannot read. Keeping a second copy of
       * the same session in `localStorage` bought nothing once the app became
       * same-origin - every request and the WebSocket upgrade already authenticate
       * by cookie - and cost something real: `localStorage` is readable by any
       * script that gets onto the page, which is precisely what `HttpOnly` exists
       * to prevent.
       *
       * So the token now lives in memory for the life of the tab, where the socket
       * shim's `?token=` fallback can still use it, and a reload rehydrates the
       * session from the cookie through `AuthMiddleware`. The persisted `user` is
       * only there to render a signed-in shell on first paint without a flash of
       * the login form; `AuthMiddleware` is what confirms it.
       */
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
