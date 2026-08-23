import { AuthModule, redisStorage } from '@dunx/auth';
import { drizzleDatabase } from '@dunx/auth/drizzle';
import { Logger, Module } from '@dunx/core';
import { DbConnection } from '@dunx/infra/db';
import { JobPublisher } from '@dunx/infra/queue';
import { RedisConnection } from '@dunx/infra/redis';
import type { BetterAuthOptions } from 'better-auth';
import { AppConfigService } from '../config/app.config.service.js';
import { AuthSessionStore } from '../config/dto/auth-vars.dto.js';
import { users } from '../users/schema/user.schema.js';
import { accounts } from './schema/account.schema.js';
import { sessions } from './schema/session.schema.js';
import { verifications } from './schema/verification.schema.js';
import { JOBS, QUEUES } from '../notifications/events/events.js';
import { AuthHooks } from './auth.hooks.js';
import { AUTH_MOUNT, AuthOptions } from './auth.options.js';
import {
  AccountLinker,
  AccountLinkerModule,
} from './services/account-linker.service.js';
import { AuthAdminSeeder } from './services/auth-admin.seeder.js';
import { CurrentUser } from './services/current-user.service.js';

/**
 * `forRootAsync` because the secret, base URL and database come out of the
 * container - better-auth reuses the handle `DatabaseModule` opened, so there is no
 * second connection. The mount is the second, **synchronous** argument because the
 * route table is built before any factory runs.
 *
 * Annotated rather than inferred: detached from the call, nothing gives
 * `sendResetPassword`'s `{ user, url }` a contextual type and it infers as `any`.
 */
const options = {
  useFactory: (
    config: AppConfigService,
    connection: DbConnection,
    redis: RedisConnection,
    publisher: JobPublisher,
    logger: Logger,
    linker: AccountLinker,
  ): BetterAuthOptions => {
    const base = AuthOptions.base(config.values, {
      // Before the demo user is deleted, and everything that references it with it.
      onLinkAccount: ({ anonymousUser, newUser }) =>
        linker.adopt(anonymousUser.user.id, newUser.user.id),
    });
    const redisSessions =
      config.get('auth').sessionStore === AuthSessionStore.REDIS;

    return {
      ...base,
      emailAndPassword: {
        ...base.emailAndPassword,
        /**
         * Without this the reset endpoint exists but answers 400, so the client's
         * "Forgot password?" flow is only real because this is here.
         *
         * Enqueued rather than sent inline: this runs inside the HTTP request, and
         * a failing provider would turn "check your inbox" into a 500 that confirms
         * the address exists.
         */
        sendResetPassword: async ({ user, url }) => {
          await publisher
            .publish(QUEUES.NOTIFICATIONS, JOBS.PASSWORD_RESET, {
              userId: user.id,
              email: user.email,
              name: user.name,
              url,
            })
            .catch((error: unknown) => {
              // With no Redis there is no queue. In development the logged link
              // is how you get it; in production it is an account-takeover
              // primitive sitting in the log aggregator, so it is gated.
              logger.warn('password reset could not be queued', {
                email: user.email,
                ...(config.get('app').nodeEnv === 'production' ? {} : { url }),
                reason: (error as Error).message,
              });
            });
        },
      },
      // The mapping is required despite the adapter's docs: it looks a model up as
      // `fullSchema['user']` - the **export name**, not the SQL table name - and
      // this app exports `users`, plural, like every other table.
      database: drizzleDatabase(connection, {
        schema: {
          user: users,
          session: sessions,
          account: accounts,
          verification: verifications,
        },
      }),
      // A hook, not a call site, so it covers every path into the user table.
      databaseHooks: AuthHooks.registration(publisher, logger),
      // An explicit opt-in, never a side effect of `REDIS_URL` being set. This is
      // the one area that does *not* degrade: `redisStorage` will not soften a
      // connection failure, because a swallowed `null` reads as "no session" and
      // signs every user out. The database default is why a clean checkout works.
      ...(redisSessions ? { secondaryStorage: redisStorage(redis) } : {}),
    };
  },
  inject: [
    AppConfigService,
    DbConnection,
    RedisConnection,
    JobPublisher,
    Logger,
    AccountLinker,
  ] as const,
};

/**
 * The better-auth root and nothing else - the profile routes and the avatar proxy
 * are `ProfileModule`'s, because neither is authentication. Named for the feature
 * so `AuthModule` still means `@dunx/auth`'s.
 *
 * A decorated class rather than an argument-less `forRoot()`, so a second importer
 * cannot build a second better-auth against a second session store, and
 * `global: true` because it is one-per-process like `DatabaseModule`.
 */
@Module({
  global: true,
  imports: [AccountLinkerModule, AuthModule.forRootAsync(options, AUTH_MOUNT)],
  providers: [CurrentUser, AuthAdminSeeder],
  /**
   * `AuthModule` **by class**, which dunx resolves to the configuration above, so a
   * consumer sees `Auth`, `AuthContext` and `SessionGuard` without naming them.
   * That resolution is what allows the class here instead of a `const` holding the
   * `forRootAsync` return - a scope is keyed on the reference it returned, so a
   * second call would name a module that is not in the graph.
   */
  exports: [AuthModule, CurrentUser],
})
export class AccountsModule {}
