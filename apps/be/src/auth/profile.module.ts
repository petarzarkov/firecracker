import { Module } from '@dunx/core';
import { ProfileController } from './profile.controller.js';
import { AvatarsService } from './services/avatars.service.js';

/**
 * The caller's own view of itself: the session as this service shapes it, and the
 * avatars offered on the sign-up form.
 *
 * It used to be three of `AccountsModule`'s bindings. Neither of them is
 * authentication - `AvatarsService` is a BetterTTV emote proxy that reaches the *AI*
 * module's named HTTP client - and keeping them there meant every feature that
 * imported that file to reach `CurrentUser` also pulled in a controller and a third
 * party this app does not control.
 *
 * Nothing is imported. `CurrentUser` comes from the `global: true` `AccountsModule`
 * and the outbound client from the `global: true` `AIModule`, which exports it by
 * reference precisely so a consumer outside that module can resolve it.
 */
@Module({ controllers: [ProfileController], providers: [AvatarsService] })
export class ProfileModule {}
