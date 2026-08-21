import { Module } from '@dunx/core';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './repos/users.repository.js';
import { UsersService } from './services/users.service.js';

/**
 * Nothing is imported. `Auth` - the service bans and unbans through better-auth's
 * own API rather than by writing the column - and `CurrentUser`, which the
 * controller reads to decide whose records a non-admin may see, both come from the
 * `global: true` `AccountsModule`. There is one better-auth per process, so naming
 * it here drew no boundary.
 *
 * `UsersService` is not exported: it is this feature's own logic, and a second
 * feature that wants to *change* a user goes through better-auth, which is the one
 * source that stays in step with sessions.
 *
 * `UsersRepository` is, and only because a read of `user.image` cannot come from
 * better-auth: `ProfileModule` serves an uploaded avatar to anyone, so it has to
 * ask whether the object is still the one its owner chose - about a user who is not
 * the caller, and therefore has no session here to read.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
