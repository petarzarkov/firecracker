import { Controller, Get, Public } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import { CurrentUser, type Caller } from './services/current-user.service.js';

/**
 * What the session actually resolved to, which is the one endpoint every client
 * of a Better Auth service needs and better-auth does not provide in the app's own
 * shape.
 *
 * Nothing here is handed a user: `CurrentUser` reads the principal out of
 * `AuthContext`, so a service two hops from the request sees the caller without it
 * being threaded through a signature.
 */
@ApiDoc({
  tags: ['profile'],
  description: 'The authenticated caller, as this service sees it.',
})
@Controller('profile')
export class ProfileController {
  constructor(private readonly caller: CurrentUser) {}

  @ApiDoc({ tags: ['profile'], summary: 'The current session' })
  @Get('/')
  me(): Caller {
    return this.caller.require();
  }

  /**
   * The guard reads this and skips: no session lookup, no rejection. A public
   * route that wants to *adapt* to an optional caller asks `CurrentUser` and gets
   * `undefined`.
   *
   * The game leans on exactly this: an anonymous visitor watches rounds and holds
   * a demo wallet, and only a bet needs a session.
   */
  @ApiDoc({
    tags: ['profile'],
    summary: 'Whether this request carried a session',
  })
  @Public()
  @Get('/anonymous')
  anonymous(): { caller: string | null } {
    return { caller: this.caller.optional()?.email ?? null };
  }
}
