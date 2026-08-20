import { Auth, rolesOf } from '@dunx/auth';
import type { BunRequest } from 'bun';

/** Who is on the far end of a socket. `null` for a spectator. */
export interface SocketPlayer {
  readonly userId: string;
  readonly email: string;
  readonly username: string;
  /** better-auth calls it `image`; the client has always called it `picture`. */
  readonly picture: string | null;
  readonly roles: readonly string[];
}

export interface GameSocketContext {
  readonly player: SocketPlayer | null;
}

/**
 * Who is on the far end of a socket, and the one uncomfortable thing the answer
 * depends on.
 *
 * A file of its own because that discomfort deserves the space: 60 lines of the
 * gateway were this, and most of them were the comment below.
 *
 * ## This never refuses the upgrade
 *
 * The template's `EventsGateway` returned a 401 from `@OnUpgrade` when there was no
 * session. This must not: watching the rocket climb is what a visitor does before
 * signing up, and the crash history and the lobby are public. A spectator gets
 * `player === null`, and every handler that spends money checks for it.
 */
export class SocketAuthService {
  /**
   * The upgrade's headers, with `?token=` promoted to `Authorization` when the
   * header is not already there. The cookie path is untouched.
   */
  static #headers(req: BunRequest): Headers {
    if (req.headers.has('authorization')) return req.headers;

    const token = new URL(req.url).searchParams.get('token');
    if (token === null || token.length === 0) return req.headers;

    const headers = new Headers(req.headers);
    headers.set('authorization', `Bearer ${token}`);
    return headers;
  }

  constructor(private readonly auth: Auth) {}

  /**
   * The session, if there is one.
   *
   * ## Why a token can arrive in the query string
   *
   * A browser's `WebSocket` constructor takes a URL and nothing else: there is no
   * way to set an `Authorization` header on the handshake. That leaves the cookie,
   * and better-auth issues its session cookie `SameSite=Lax`, which a browser sends
   * on top-level navigations and **not** on a cross-origin WebSocket upgrade. In
   * development the client is on Vite's port and the API is on its own, so the
   * cookie never arrives and every socket would be anonymous.
   *
   * So `?token=` is read as a fallback and turned into the `Authorization` header
   * better-auth's `bearer()` plugin already understands. The cookie is still
   * preferred and is what production uses, where the client is served same-origin.
   *
   * The token must be **percent-encoded** by the caller: better-auth issues base64,
   * which routinely contains `/`, `+` and `=`, and an unencoded `+` arrives here as
   * a space. `URL.searchParams.set` does this for free, which is what the client
   * shim uses.
   *
   * A token in a query string is worth being uncomfortable about - it lands in
   * server access logs and in `Referer` on any request the page makes afterwards.
   * It is acceptable here because it is only reached for cross-origin development,
   * and because the alternative is developing against an app where nobody is ever
   * logged in. It is **not** a pattern to copy onto an HTTP route.
   */
  async context(req: BunRequest): Promise<GameSocketContext> {
    const principal = await this.auth.api
      .getSession({ headers: SocketAuthService.#headers(req) })
      .catch(() => null);

    if (principal === null) return { player: null };

    const { user } = principal;
    return {
      player: {
        userId: user.id,
        email: user.email,
        username: user.name || user.email.split('@')[0] || user.id,
        picture: user.image ?? null,
        roles: rolesOf(user),
      },
    };
  }
}
