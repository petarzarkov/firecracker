import { describe, expect, test } from 'bun:test';
import { getTestContext } from '../setup/context.js';

/**
 * The endpoints the browser client actually calls.
 *
 * They are here rather than in a unit test because the whole point of this suite
 * is that they exist *at these paths*, on a real server, with the plugin list this
 * app configures. The migration broke every one of them - the NestJS app had
 * `/auth/login`, `/auth/register`, `/auth/demo` and `/auth/forgotten-password`,
 * and Better Auth has none of those names. A typo here is a client that cannot
 * sign anybody in, and nothing else would catch it.
 */
const json = (origin: string, path: string, body: object) =>
  fetch(`${origin}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const uniqueEmail = () => `player-${crypto.randomUUID()}@example.com`;

describe('the auth endpoints the client calls', () => {
  test('sign-up returns a session token the client can hold', async () => {
    const { origin } = getTestContext();
    const email = uniqueEmail();

    const response = await json(origin, '/sign-up/email', {
      email,
      password: 'a-password-123',
      name: 'Player',
    });
    const body = (await response.json()) as {
      token?: string;
      user?: { email: string };
    };

    expect(response.status).toBe(200);
    expect(body.user?.email).toBe(email);
    // Either carrier is fine - the client checks both, because a proxy that
    // strips unknown response headers would otherwise leave it with no token.
    expect(response.headers.get('set-auth-token') ?? body.token).toBeTruthy();
  });

  test('sign-in works with the credential sign-up created', async () => {
    const { origin } = getTestContext();
    const email = uniqueEmail();
    await json(origin, '/sign-up/email', {
      email,
      password: 'a-password-123',
      name: 'Player',
    });

    const response = await json(origin, '/sign-in/email', {
      email,
      password: 'a-password-123',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-auth-token')).toBeTruthy();
  });

  test('a wrong password is a 401, not a 500', async () => {
    const { origin } = getTestContext();
    const email = uniqueEmail();
    await json(origin, '/sign-up/email', {
      email,
      password: 'a-password-123',
      name: 'Player',
    });

    const response = await json(origin, '/sign-in/email', {
      email,
      password: 'not-the-password',
    });
    expect(response.status).toBe(401);
  });

  /**
   * "Try Demo". A crash game nobody can try without handing over an email is a
   * worse product, and the demo wallet needs a user row to belong to - so this is
   * a real account that happens to have no credential.
   */
  test('anonymous sign-in creates a player with a funded demo wallet', async () => {
    const { origin } = getTestContext();

    const response = await json(origin, '/sign-in/anonymous', {});
    const body = (await response.json()) as {
      token?: string;
      user?: { isAnonymous?: boolean };
    };
    expect(response.status).toBe(200);
    expect(body.user?.isAnonymous).toBe(true);

    const token = response.headers.get('set-auth-token') ?? body.token;
    const wallet = await fetch(`${origin}/api/wallet?isDemo=true`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const balance = (await wallet.json()) as { balanceCents: number };

    expect(wallet.status).toBe(200);
    expect(balance.balanceCents).toBeGreaterThan(0);
  });

  /**
   * The reset flow only answers at all because `sendResetPassword` is configured -
   * without it better-auth refuses with "Reset password isn't enabled". The reply
   * is deliberately the same whether or not the address exists.
   */
  test('a password reset can be requested', async () => {
    const { origin } = getTestContext();
    const email = uniqueEmail();
    await json(origin, '/sign-up/email', {
      email,
      password: 'a-password-123',
      name: 'Player',
    });

    const response = await json(origin, '/request-password-reset', {
      email,
      redirectTo: 'http://localhost:5173',
    });
    expect(response.status).toBe(200);

    const unknown = await json(origin, '/request-password-reset', {
      email: 'nobody@example.com',
      redirectTo: 'http://localhost:5173',
    });
    expect(unknown.status).toBe(200);
  });

  test('signing out kills the session the token pointed at', async () => {
    const { origin } = getTestContext();
    const email = uniqueEmail();
    const signUp = await json(origin, '/sign-up/email', {
      email,
      password: 'a-password-123',
      name: 'Player',
    });
    const token =
      signUp.headers.get('set-auth-token') ??
      ((await signUp.json()) as { token?: string }).token;

    await fetch(`${origin}/api/auth/sign-out`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });

    const after = await fetch(`${origin}/api/auth/get-session`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const session = (await after.json().catch(() => null)) as {
      user?: unknown;
    } | null;
    expect(session?.user).toBeUndefined();
  });
});
