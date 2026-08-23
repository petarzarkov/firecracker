import { Auth } from '@dunx/auth';
import { ApiHidden, Controller, Get, Public } from '@dunx/http';
import type { BunRequest } from 'bun';
import { AUTH_MOUNT } from './auth.options.js';

/**
 * The providers this may rewrite for.
 *
 * An allow-list and not the `:provider` segment, because this hands a caller-shaped
 * path to better-auth's own dispatcher: without it, `/api/auth/anything/callback`
 * would reach `/api/auth/callback/anything`, which is a stranger deciding which
 * better-auth route runs.
 */
const REWRITABLE = new Set(['google', 'github', 'linkedin']);

/**
 * The callback URL the NestJS version registered, still answered.
 *
 * Passport composed `${webUrl}/${apiPath}/auth/<provider>/callback` - provider
 * *before* the literal - and better-auth serves `/callback/<provider>`, provider
 * after. The OAuth apps at GitHub and LinkedIn hold the Passport shape, a GitHub
 * OAuth App holds exactly one callback URL, and GitHub's "extra path segments are
 * permitted" rule does not help because the new path is not under the old one. So
 * either the registrations change, or this does - and this is the half that is ours.
 *
 * It pairs with `redirectURI` in {@link AuthOptions.base}: that is what makes the
 * authorization request *and* the token exchange both name the legacy URL, which is
 * what the provider compares against. Neither half works alone - a `redirectURI`
 * with no route here lands the browser on a 404, and a route here with no
 * `redirectURI` is never reached.
 *
 * **Delegated, not redirected.** A 302 to the canonical path would work, but it
 * spends a round trip and puts the one-time `code` in a second `Location` header
 * and a second referrer. Rewriting the URL and calling the same handler
 * `MountedAuthHandler` calls keeps the state cookie and the `Set-Cookie` of the new
 * session on one request.
 */
@ApiHidden()
@Controller(AUTH_MOUNT)
export class LegacyOAuthCallbackController {
  constructor(private readonly auth: Auth) {}

  /**
   * `@Public()`, because nobody has a session yet - that is what the callback is
   * for. This has to out-rank `MountedAuthHandler`'s `/*`, which it does because a
   * parameterised segment beats a wildcard in the route table; the spec beside this
   * asserts the reach rather than trusting that.
   */
  @Public()
  @Get('/:provider/callback')
  callback({ req }: { req: BunRequest }): Promise<Response> {
    const url = new URL(req.url);
    const provider = url.pathname.split('/').at(-2) ?? '';

    if (!REWRITABLE.has(provider)) {
      return Promise.resolve(new Response('Not found', { status: 404 }));
    }

    // Only the last two segments swap; the prefix better-auth is mounted under is
    // whatever it already was, so nothing here has to know the global prefix.
    url.pathname = url.pathname.replace(
      new RegExp(`/${provider}/callback$`),
      `/callback/${provider}`,
    );
    return this.auth.handler(new Request(url.toString(), req));
  }
}
