import { Controller, Get, Public } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import { AvatarsService } from './services/avatars.service.js';
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
  constructor(
    private readonly caller: CurrentUser,
    private readonly avatars: AvatarsService,
  ) {}

  @ApiDoc({ tags: ['profile'], summary: 'The current session' })
  @Get('/')
  me(): Caller {
    return this.caller.require();
  }

  /**
   * Avatar suggestions for the sign-up form.
   *
   * `@Public()` because it is reached *before* anybody has an account - that is the
   * whole point of it. Under `/profile` rather than `/auth`, which better-auth owns.
   */
  @ApiDoc({ tags: ['profile'], summary: 'Trending avatars to choose from' })
  @Public()
  @Get('/avatars/trending')
  async trendingAvatars(): Promise<{ avatars: readonly string[] }> {
    return { avatars: await this.avatars.trending() };
  }
}
