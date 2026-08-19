import { afterEach, describe, expect, test } from 'bun:test';
import { AuthError, signInAnonymous } from './auth-api';

/**
 * The cookie outlives `localStorage`, and "Try Demo" is the one button an
 * unregistered visitor has.
 *
 * Rebuild the client, clear site data on one origin, or lose the store to a
 * `clearAuth()`, and the browser still holds a session for a live anonymous user.
 * better-auth then refuses a second one, and surfacing that refusal put the login
 * form in a dead end - the button reported "Anonymous users cannot sign in again
 * anonymously" forever, with no route out of the UI.
 */
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const ALREADY = {
  message: 'Anonymous users cannot sign in again anonymously',
  code: 'ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY',
};

const DEMO_USER = {
  id: 'user-1',
  email: 'demo@demo.firecracker.local',
  name: 'Demo',
  isAnonymous: true,
};

/** Answers each path once, and records what was asked for. */
const stub = (routes: Record<string, () => Response>): { calls: string[] } => {
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const path = Object.keys(routes).find((key) => url.includes(key));
    calls.push(path ?? url);
    if (path === undefined) return Promise.resolve(json(404, {}));
    return Promise.resolve(routes[path]!());
  }) as typeof fetch;
  return { calls };
};

describe('signInAnonymous', () => {
  test('returns the new session on the happy path', async () => {
    stub({
      '/sign-in/anonymous': () => json(200, { token: 't', user: DEMO_USER }),
    });

    const session = await signInAnonymous();
    expect(session.user.id).toBe('user-1');
    expect(session.user.isDemo).toBe(true);
    expect(session.token).toBe('t');
  });

  test('adopts the existing session when the server refuses a second one', async () => {
    const { calls } = stub({
      '/sign-in/anonymous': () => json(400, ALREADY),
      '/get-session': () => json(200, { user: DEMO_USER }),
    });

    const session = await signInAnonymous();

    expect(calls).toEqual(['/sign-in/anonymous', '/get-session']);
    expect(session.user.id).toBe('user-1');
    expect(session.user.isDemo).toBe(true);
  });

  /**
   * A cookie naming a user that no longer exists. Reporting "already signed in"
   * there would be a worse lie than the refusal, so the original error stands.
   */
  test('rethrows when the cookie names nobody', async () => {
    stub({
      '/sign-in/anonymous': () => json(400, ALREADY),
      '/get-session': () => json(200, {}),
    });

    expect(signInAnonymous()).rejects.toThrow(
      /cannot sign in again anonymously/i,
    );
  });

  test('a different failure is not swallowed', async () => {
    const { calls } = stub({
      '/sign-in/anonymous': () =>
        json(429, { message: 'Too many requests', code: 'RATE_LIMITED' }),
    });

    await expect(signInAnonymous()).rejects.toBeInstanceOf(AuthError);
    // No recovery attempt: only the "you already have one" code means that.
    expect(calls).toEqual(['/sign-in/anonymous']);
  });
});
