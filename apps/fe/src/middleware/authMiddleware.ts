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
    // Only polices a session it already knows about: an idle visitor who has never
    // signed in has nothing to re-check, and should not be asking every 5 minutes.
    AuthMiddleware.#timer = setInterval(() => {
      if (useAuthStore.getState().user !== null) void AuthMiddleware.#sync();
    }, CHECK_INTERVAL_MS);

    // On load, **unconditionally**. A persisted `localStorage` state is the one most
    // likely to be stale, and an *absent* one does not mean absent session.
    void AuthMiddleware.#sync();
  }

  static cleanup(): void {
    if (AuthMiddleware.#timer !== null) clearInterval(AuthMiddleware.#timer);
    AuthMiddleware.#timer = null;
  }

  /**
   * Asks the server who the caller is, and makes the store agree.
   *
   * ## The boot call must run even with an empty store
   *
   * This used to open with `if (user === null) return;`, which made the cookie
   * unreachable: the session's real carrier is better-auth's `HttpOnly` cookie and
   * only `user` is persisted, so anything that clears `localStorage` without clearing
   * cookies - a rebuild, "clear site data" on one origin, a `clearAuth()` from a
   * blip - left a live session the client could not see. The app rendered the login
   * form, and "Try Demo" then asked for a second anonymous session and was refused
   * with `ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY`. No route out of the UI.
   *
   * `authStore`'s own comment already promised this - "a reload rehydrates the session
   * from the cookie through `AuthMiddleware`" - and the guard is what stopped it.
   *
   * The cost is one `/get-session` on boot for a visitor who has never signed in.
   * That is the honest price of being cookie-first: whether a session exists is a
   * question only the server can answer.
   */
  static async #sync(): Promise<void> {
    const { token, user, setAuth, clearAuth } = useAuthStore.getState();

    let session: Awaited<ReturnType<typeof authApi.currentSession>>;
    try {
      session = await authApi.currentSession(token);
    } catch {
      // The network is down, or the API is restarting. **Not** a signed-out user:
      // clearing here would log someone out because their wifi blinked.
      return;
    }

    if (session === null) {
      // Only if there was something to clear. A visitor with no session would
      // otherwise get a state write, and a persist round-trip, on every load.
      if (user !== null) clearAuth();
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
      void AuthMiddleware.#sync();
    }
  }
}
