import type { User } from '@/store/authStore';
import { UserRole } from '@/types';

/**
 * Better Auth over `fetch`, in the shape this app already had.
 *
 * ## Why this is hand-written and not `better-auth/client`
 *
 * The official client is good and would work. It also pulls the whole library
 * into a browser bundle to call seven endpoints, and it owns session storage - a
 * job zustand already does here, with `persist`, and which the socket depends on
 * because the WebSocket upgrade carries `?token=`. Two things believing they own
 * the session is worse than one small module.
 *
 * ## The endpoints changed, not the flow
 *
 * The NestJS version had hand-rolled routes. Better Auth's own are close enough
 * that only this file moved:
 *
 * | was                             | now                             |
 * | ------------------------------- | ------------------------------- |
 * | `POST /auth/login`              | `POST /auth/sign-in/email`      |
 * | `POST /auth/register`           | `POST /auth/sign-up/email`      |
 * | `GET  /auth/github` (redirect)  | `POST /auth/sign-in/social`     |
 * | `POST /auth/demo`               | `POST /auth/sign-in/anonymous`  |
 * | `POST /auth/forgotten-password` | `POST /auth/request-password-reset` |
 * | `POST /auth/password-reset`     | `POST /auth/reset-password`     |
 */

const API = import.meta.env.VITE_API_URL ?? '';
const AUTH = `${API}/api/auth`;

/** What better-auth returns as a user, before it becomes this app's shape. */
interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role?: string | null;
  isAnonymous?: boolean | null;
}

export interface Session {
  /**
   * `null` after a social sign-in, and that is not a failure.
   *
   * better-auth hands a bearer token back only on a response that also sets the
   * session cookie, and the OAuth callback's redirect never reaches this client.
   * Since the app is same-origin in both development and production, the cookie
   * authenticates every request *and* the WebSocket upgrade on its own - the token
   * is what the `?token=` fallback needs, and only a cross-origin client needs
   * that.
   */
  readonly token: string | null;
  readonly user: User;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * better-auth's user, in this app's shape.
 *
 * `role` is a single string on the wire and a list here, because the UI checks
 * membership. `displayName` falls back to the email local-part, which is the same
 * rule the server's lobby uses - so a player is called one thing in both places.
 */
const toUser = (user: AuthUser): User => ({
  id: user.id,
  email: user.email,
  displayName: user.name || user.email.split('@')[0] || user.id,
  picture: user.image ?? null,
  roles: [(user.role as UserRole) ?? UserRole.USER],
  isDemo: user.isAnonymous ?? false,
});

const post = async <T>(
  path: string,
  body: object,
): Promise<Response & { data: T }> => {
  const response = await fetch(`${AUTH}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Sends and accepts the session cookie, which is what production uses. The
    // bearer token below is the belt to that pair of braces, and what the socket
    // needs because a WebSocket cannot carry a header.
    credentials: 'include',
    body: JSON.stringify(body),
  });

  const data = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    code?: string;
  };

  if (!response.ok) {
    throw new AuthError(data.message ?? 'Request failed', data.code);
  }
  return Object.assign(response, { data });
};

/**
 * The token, from wherever better-auth put it.
 *
 * The `bearer()` plugin sets `set-auth-token`; the body also carries `token` on
 * the sign-in and sign-up routes. Both are checked because a proxy that strips
 * unknown response headers would otherwise silently produce a signed-in user with
 * no token, and therefore a socket that connects as a spectator.
 */
const tokenFrom = (
  response: Response,
  body: { token?: string },
): string | null =>
  response.headers.get('set-auth-token') ?? body.token ?? null;

export const signIn = async (
  email: string,
  password: string,
): Promise<Session> => {
  const response = await post<{ token?: string; user: AuthUser }>(
    '/sign-in/email',
    { email, password },
  );
  return {
    token: tokenFrom(response, response.data),
    user: toUser(response.data.user),
  };
};

export const signUp = async (input: {
  email: string;
  password: string;
  name: string;
  image?: string | undefined;
}): Promise<Session> => {
  const response = await post<{ token?: string; user: AuthUser }>(
    '/sign-up/email',
    {
      email: input.email,
      password: input.password,
      name: input.name,
      ...(input.image === undefined ? {} : { image: input.image }),
    },
  );
  return {
    token: tokenFrom(response, response.data),
    user: toUser(response.data.user),
  };
};

/**
 * better-auth's refusal when the caller **already has** an anonymous session.
 *
 * It is not an error condition for this app: the demo button asks for a demo
 * player, and a live one on the cookie is that. See {@link signInAnonymous}.
 */
const ALREADY_ANONYMOUS = 'ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY';

/**
 * "Try Demo" - a real user row with a wallet, and no credential.
 *
 * **Adopts an existing anonymous session rather than failing on one.** The cookie
 * outlives `localStorage`: rebuild the client, clear site data, or lose the store to
 * a `clearAuth()`, and the browser still holds a session for a live anonymous user.
 * better-auth then answers `ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY`, and
 * surfacing that put the login form in a dead end - the one button an unregistered
 * visitor has, refusing forever, with no way out of the UI.
 *
 * The refusal already tells us what we need: there is a demo player on this cookie.
 * So it is answered by asking who that is.
 */
export const signInAnonymous = async (): Promise<Session> => {
  try {
    const response = await post<{ token?: string; user: AuthUser }>(
      '/sign-in/anonymous',
      {},
    );
    return {
      token: tokenFrom(response, response.data),
      user: toUser(response.data.user),
    };
  } catch (error) {
    if (!(error instanceof AuthError) || error.code !== ALREADY_ANONYMOUS) {
      throw error;
    }
    // Rethrow the original if the cookie turns out to name nobody - a session for a
    // user that was deleted would land here, and reporting "already signed in" for
    // it would be a worse lie than the refusal.
    const session = await currentSession();
    if (session === null) throw error;
    return session;
  }
};

export type SocialProvider = 'github' | 'google' | 'linkedin';

/**
 * Social sign-in is a POST that *returns* a URL rather than a redirect to follow.
 *
 * That is the change from `window.location.href = '/api/auth/github'`: better-auth
 * wants to set its state cookie before the browser leaves, so the navigation
 * happens here, afterwards, with the URL it hands back.
 */
export const signInSocial = async (
  provider: SocialProvider,
  callbackURL: string,
): Promise<void> => {
  const response = await post<{ url?: string; redirect?: boolean }>(
    '/sign-in/social',
    { provider, callbackURL },
  );
  if (!response.data.url) {
    throw new AuthError(`${provider} sign-in is not configured on the server.`);
  }
  window.location.href = response.data.url;
};

export const requestPasswordReset = async (
  email: string,
  redirectTo: string,
): Promise<void> => {
  await post('/request-password-reset', { email, redirectTo });
};

export const resetPassword = async (
  token: string,
  newPassword: string,
): Promise<void> => {
  await post('/reset-password', { token, newPassword });
};

/**
 * Who the caller is, by cookie or by token, or `null`.
 *
 * Two callers, both of which need the same answer:
 *
 *  - **The OAuth callback**, which has a cookie and nothing else.
 *  - **Boot**, because a persisted token in `localStorage` proves nothing about
 *    whether the session behind it is still alive. A client that assumes it is
 *    renders a signed-in header over an app that 401s on every call - which is
 *    what the old JWT-expiry guesswork in `authMiddleware` was trying to avoid,
 *    and got wrong.
 */
export const currentSession = async (
  token?: string | null,
): Promise<Session | null> => {
  const response = await fetch(`${AUTH}/get-session`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as {
    user?: AuthUser;
  } | null;
  if (!body?.user) return null;

  return {
    // A refreshed session re-sets the cookie, which is when the bearer plugin
    // emits a new token. Otherwise keep whatever we already had.
    token: response.headers.get('set-auth-token') ?? token ?? null,
    user: toUser(body.user),
  };
};

export const signOut = async (token?: string | null): Promise<void> => {
  await fetch(`${AUTH}/sign-out`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  }).catch(() => undefined);
};
