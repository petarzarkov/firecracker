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
 * That boundary is where the migration's risk actually was, and the comment used to
 * say so in the abstract: "getting the redirect wrong - a stale callback path - is
 * the failure that would only show up in front of a user." It then happened. The
 * NestJS version registered `/api/auth/<provider>/callback` with all three
 * providers, better-auth builds `/callback/<provider>`, and every sign-in was
 * refused with "the redirect_uri is not associated with this application" - so the
 * app follows the registrations now, and this asserts the URL *and* that something
 * answers at it.
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

      /*
        The Passport shape - provider segment *before* the literal - because that is
        what the OAuth apps are registered with, and the provider compares
        `redirect_uri` against its registration. better-auth's own convention is the
        reverse, `/callback/<provider>`, which is what it answered here until the
        registrations turned out to still be the NestJS version's. See
        `AuthOptions.legacyCallback`.

        On this server's origin and not the client's: `callbackURL` above is where
        the *browser* is sent afterwards, and confusing the two sends the code to
        the SPA.
      */
      const redirect = new URL(url.searchParams.get('redirect_uri') as string);
      expect(redirect.pathname).toBe(`/api/auth/${name}/callback`);
      /*
        Compared by port rather than by whole origin: `getTestContext` reports
        `127.0.0.1` and better-auth builds its base URL from `WEB_URL`, which defaults
        to `localhost` - the same server under two names, and asserting the string
        would fail on the spelling instead of on the thing that matters.
      */
      expect(redirect.port).toBe(new URL(origin).port);

      /*
        And that URL is a route this app serves.

        This is the assertion with teeth. Pinning `redirect_uri` and serving the path
        are two separate pieces - `redirectURI` on the provider, and
        `LegacyOAuthCallbackController` - and either one alone looks completely fine
        from the outside: the authorize URL is still built, still signed, still has a
        state. The failure is a user coming *back* to a 404 with a spent code.

        Being bounced to better-auth's own error page is the healthy answer: this
        request carries no state and no cookie, so refusing it is correct and proves
        the handler ran, where a 404 would mean only half the change survived. The
        error *code* is not asserted, because which one it is depends on how little
        this request carries - `state_not_found` bare, `state_mismatch` with an
        unmatched one - and neither is the point.
      */
      const landing = await fetch(redirect, { redirect: 'manual' });
      expect(landing.status).not.toBe(404);
      expect(landing.headers.get('location')).toContain('/api/auth/error');

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
