import { useAuthStore } from '@/store/authStore';

const API = import.meta.env.VITE_API_URL ?? '';

/**
 * A `fetch` that carries the caller's session.
 *
 * ## Why this exists rather than a bare `fetch`
 *
 * The session's carrier is better-auth's `HttpOnly` cookie, and a cookie only
 * rides a request that asks for it - `credentials: 'include'`. A call that forgets
 * gets a 401 while the user is plainly signed in, which is exactly the bug this
 * replaced: `PlayerHistory` sent `Authorization: Bearer <token>` and nothing else,
 * so the moment the token stopped being persisted to `localStorage`, "MY BETS"
 * went permanently empty after a reload.
 *
 * The bearer header is still sent **when there is a token**, which covers the tab
 * that just signed in and any future cross-origin deployment. It is an addition to
 * the cookie, never a replacement for it.
 */
export const apiFetch = async (
  path: string,
  init: RequestInit = {},
): Promise<Response> => {
  const { token } = useAuthStore.getState();
  const headers = new Headers(init.headers);
  if (token !== null && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }

  return fetch(`${API}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
};
