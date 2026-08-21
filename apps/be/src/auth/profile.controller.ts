import { Controller, Get, Post, Public, type Input } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import { avatarFile, setAvatar } from './dto/profile.dto.js';
import { AvatarsService } from './services/avatars.service.js';
import { CurrentUser, type Caller } from './services/current-user.service.js';
import { ProfilePictureService } from './services/profile-picture.service.js';

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
    private readonly picture: ProfilePictureService,
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

  /**
   * Point `users.image` at an object the caller uploaded, or at a URL they chose.
   *
   * No `@Throttle`. The bytes went through `POST /api/files`, which is where
   * `UPLOAD_MAX_BYTES` and the configured limit already apply; this is a column
   * write, and a literal here could only restate the default - which is a no-op
   * that no environment can then raise.
   *
   * `input.req.headers` is passed on because better-auth's `updateUser` needs the
   * caller's session to update it, and answers with the cookie that keeps its
   * cached copy in step.
   */
  @ApiDoc({ tags: ['profile'], summary: 'Set the caller’s avatar' })
  @Post('/avatar', setAvatar)
  avatar(input: Input<typeof setAvatar>): Promise<Response> {
    return this.picture.set(input.req.headers, input.body);
  }

  /**
   * `@Public()` because an avatar is read by whoever can see the player: the lobby
   * chat carries a sender's picture and a spectator has no session. Which objects
   * that admits is `ProfilePictureService.bytes`'s decision, not this route's.
   */
  @ApiDoc({ tags: ['profile'], summary: 'An avatar’s bytes' })
  @Public()
  @Get('/avatar/:fileId', avatarFile)
  avatarBytes(input: Input<typeof avatarFile>): Promise<Response> {
    return this.picture.bytes(input.params.fileId);
  }
}
