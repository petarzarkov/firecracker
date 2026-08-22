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
 * Who is on the far end of a socket. Never refuses the upgrade - watching is what a
 * visitor does before signing up - so a spectator gets `player === null` and every
 * handler that spends money checks for it.
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
   * The session, if there is one. A browser cannot set a header on a WebSocket
   * handshake, and better-auth's cookie is `SameSite=Lax`, which does not ride a
   * cross-origin upgrade - so `?token=` is read as a fallback and turned into the
   * `Authorization` header the `bearer()` plugin understands. The cookie is
   * preferred and is what production uses.
   *
   * The token must be **percent-encoded**: better-auth issues base64, which
   * contains `/`, `+` and `=`, and an unencoded `+` arrives as a space.
   *
   * A token in a query string lands in access logs and in `Referer`. Acceptable
   * only because this is reached for cross-origin development; **not** a pattern to
   * copy onto an HTTP route.
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
