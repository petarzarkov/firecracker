import { Module } from '@dunx/core';
import { AccountsModule } from '../auth/auth.module.js';
import { InvitesController } from './invites.controller.js';
import { UsersRepository } from '../users/repos/users.repository.js';
import { InvitesRepository } from './repos/invites.repository.js';
import { InvitesService } from './services/invites.service.js';

/**
 * `AccountsModule` for `Auth`: accepting an invitation creates the account through
 * better-auth's own sign-up rather than by inserting a row, so the new user has a
 * real credential and can sign in - which is the same reason `UsersService` goes
 * through it.
 */
@Module({
  imports: [AccountsModule],
  controllers: [InvitesController],
  /**
   * `UsersRepository` is provided here rather than imported: `UsersModule` exports
   * nothing on purpose, and a repository is a stateless wrapper over the one
   * database handle - so a second instance is a second object, not a second
   * connection. The same call `GameBetRepository` makes for player names.
   */
  providers: [InvitesService, InvitesRepository, UsersRepository],
})
export class InvitesModule {}
