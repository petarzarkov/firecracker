import { useAuthStore } from '../store/authStore';
import * as authApi from '../systems/auth/auth-api';

/** How often a live session is re-checked against the server. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Keeps the client's idea of "signed in" honest, by **asking the server** rather
 * than reading the token.
 *
 * Do not reintroduce a client-side expiry check. A better-auth session token is
 * `<id>.<hmac>`, where the second segment is a signature and not base64 JSON, so
 * decoding it as a JWT throws - and a `catch` that reads a throw as expiry logs
 * **every signed-in user out within a minute of loading the page**, forever, with
 * the reason buried in a `console.error`. That shipped.
 *
 * Asking also covers what no local check can see: a session revoked elsewhere, a
 * banned user, a token deleted on sign-out from another tab.
 */
export class AuthMiddleware {
  static #timer: ReturnType<typeof setInterval> | null = null;
  static #inFlight: Promise<void> | null = null;

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
   * **No `if (user === null) return;` guard.** The session's real carrier is
   * better-auth's `HttpOnly` cookie and only `user` is persisted, so anything that
   * clears `localStorage` without clearing cookies - a rebuild, "clear site data" on
   * one origin, a `clearAuth()` from a blip - leaves a live session the client cannot
   * see. The app then renders the login form, and "Try Demo" is refused with
   * `ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY`: no route out of the UI.
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
   * Settle the session now, because something just answered 401.
   *
   * The boot `#sync()` covers a stale cookie on *load*, but a route can refuse
   * mid-session - revoked elsewhere, banned, or simply a cookie the server stopped
   * accepting - and without this the client keeps rendering signed-in until the
   * five-minute poll comes round.
   *
   * Coalesced: a page that fires three requests gets three 401s, and one answer to
   * "am I still signed in" is enough for all of them.
   */
  static revalidate(): void {
    if (AuthMiddleware.#inFlight !== null) return;
    AuthMiddleware.#inFlight = AuthMiddleware.#sync().finally(() => {
      AuthMiddleware.#inFlight = null;
    });
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
