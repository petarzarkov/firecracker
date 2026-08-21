import { Module } from '@dunx/core';
import { UsersModule } from '../users/users.module.js';
import { ProfileController } from './profile.controller.js';
import { AvatarsService } from './services/avatars.service.js';
import { ProfilePictureService } from './services/profile-picture.service.js';

/**
 * The caller's own view of itself: the session as this service shapes it, the
 * avatars offered on the sign-up form, and the one a player uploads for themselves.
 *
 * Not `AccountsModule`'s: neither is authentication, and keeping them there meant
 * every feature importing that file for `CurrentUser` also pulled in a controller and
 * a third party this app does not control.
 *
 * `UsersModule` is the one import, for `UsersRepository` - the avatar routes read
 * `user.image` of a player who is not the caller, which no session can answer.
 * `CurrentUser` comes from the `global: true` `AccountsModule`, the outbound client
 * from the `global: true` `AIModule` and `FilesService` from `FilesFeatureModule`,
 * which is global for the same reason: it is configured twice, once per graph, so
 * importing it here would be a third scope.
 */
@Module({
  imports: [UsersModule],
  controllers: [ProfileController],
  providers: [AvatarsService, ProfilePictureService],
})
export class ProfileModule {}
