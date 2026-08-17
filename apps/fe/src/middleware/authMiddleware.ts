import { useAuthStore } from '../store/authStore';
import * as authApi from '../systems/auth/auth-api';

/** How often a live session is re-checked against the server. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Keeps the client's idea of "signed in" honest.
 *
 * ## What this used to do, and why it was a bug waiting for the migration
 *
 * It decoded the stored token as a JWT - `JSON.parse(atob(token.split('.')[1]))` -
 * read `exp`, and signed the user out five minutes before it. That worked against
 * the NestJS app, which issued JWTs.
 *
 * better-auth does not. Its session token is `<id>.<hmac>`, where the second
 * segment is a signature and not base64 JSON, so `JSON.parse` throws - and the old
 * `catch` treated a throw as expiry. Left alone, **every signed-in user would have
 * been logged out within a minute of loading the page**, forever, with the reason
 * buried in a `console.error`.
 *
 * The replacement does not guess. Sessions live on the server; the server is the
 * thing that knows whether one is still valid, so this asks it. That also covers
 * the cases the old code could not see at all: a session revoked elsewhere, a
 * banned user, a token deleted on sign-out from another tab.
 */
export class AuthMiddleware {
  static #timer: ReturnType<typeof setInterval> | null = null;

  static initialize(): void {
    AuthMiddleware.#timer = setInterval(() => {
      void AuthMiddleware.#verify();
    }, CHECK_INTERVAL_MS);

    // On load as well as on the interval: a persisted `localStorage` state is the
    // one most likely to be stale, because it survived a browser restart.
    void AuthMiddleware.#verify();
  }

  static cleanup(): void {
    if (AuthMiddleware.#timer !== null) clearInterval(AuthMiddleware.#timer);
    AuthMiddleware.#timer = null;
  }

  static async #verify(): Promise<void> {
    const { token, user, setAuth, clearAuth } = useAuthStore.getState();
    if (user === null) return;

    let session: Awaited<ReturnType<typeof authApi.currentSession>>;
    try {
      session = await authApi.currentSession(token);
    } catch {
      // The network is down, or the API is restarting. **Not** a signed-out user:
      // clearing here would log someone out because their wifi blinked.
      return;
    }

    if (session === null) {
      clearAuth();
      return;
    }

    // Refresh what the server says - a role change or a new token from a rolled
    // session lands here rather than waiting for a reload.
    setAuth(session.token, session.user);
  }

  /**
   * Called when the socket refuses. Only clears on an authentication failure -
   * a transport drop is what the shim's reconnect is for.
   */
  static handleWebSocketError(error: unknown): void {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : '';

    if (/unauthor|forbidden|session/i.test(message)) {
      void AuthMiddleware.#verify();
    }
  }
}
