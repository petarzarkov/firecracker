import { describe, expect, test } from 'bun:test';
import { getTestContext } from '../setup/context.js';

const PROVIDERS = [
  { name: 'github', authorize: 'https://github.com/login/oauth/authorize' },
  { name: 'google', authorize: 'https://accounts.google.com/o/oauth2/v2/auth' },
  {
    name: 'linkedin',
    authorize: 'https://www.linkedin.com/oauth/v2/authorization',
  },
] as const;

/**
 * Social sign-in, as far as it can honestly be tested without a real provider.
 *
 * The exchange itself needs GitHub, Google or LinkedIn to answer, and an e2e that
 * depended on all three would be a suite that fails when somebody else deploys. So
 * the assertion stops at the boundary this app owns: the authorize URL it builds.
 *
 * That boundary is where the migration's risk actually was. The NestJS version had
 * three passport strategies with three hand-written callback routes; better-auth
 * has one endpoint and derives the rest. Getting the redirect wrong - a stale
 * callback path, a missing client id, no `state` - is the failure that would only
 * show up in front of a user.
 */
describe('social sign-in', () => {
  for (const { name, authorize } of PROVIDERS) {
    test(`${name} returns an authorize URL pointing back at our callback`, async () => {
      const { origin } = getTestContext();

      const response = await fetch(`${origin}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: name,
          callbackURL: 'http://localhost:5173',
        }),
      });
      const body = (await response.json()) as { url?: string };

      expect(response.status).toBe(200);
      expect(body.url).toBeDefined();

      const url = new URL(body.url as string);
      expect(`${url.origin}${url.pathname}`).toBe(authorize);
      expect(url.searchParams.get('client_id')).toBe(`e2e-${name}-id`);
      // The callback has to be this server's own handler, not the client's.
      expect(url.searchParams.get('redirect_uri')).toContain(
        `/api/auth/callback/${name}`,
      );
      // CSRF: better-auth pairs this with a cookie it checks on the way back.
      expect(url.searchParams.get('state')).toBeTruthy();
    });
  }

  test('an unknown provider is refused rather than redirected', async () => {
    const { origin } = getTestContext();
    const response = await fetch(`${origin}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'myspace', callbackURL: 'http://x' }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
