import type { ConfigSource, DynamicModule, ModuleRef } from '@dunx/core';
import { ClientAddress, RedisThrottleStore, ThrottleModule } from '@dunx/http';
import { LoggerModule } from '@dunx/infra/logger';
import { RedisConnection } from '@dunx/infra/redis';
import type { BunRequest } from 'bun';
import { AccountsModule } from './auth/auth.module.js';
import { CurrentUser } from './auth/services/current-user.service.js';
import { ProfileModule } from './auth/profile.module.js';
import { AIModule } from './ai/ai.module.js';
import { AppConfigModule } from './config/app.config.module.js';
import { ClientModule } from './client/client.module.js';
import { FilesFeatureModule } from './files/files.module.js';
import { StorageModule } from './infra/files/storage.module.js';
import { ImagesConfigModule } from './infra/images/images.module.js';
import { AppConfigService } from './config/app.config.service.js';
import { GameModule } from './game/game.module.js';
import { DatabaseModule } from './infra/db/database.module.js';
import { ServiceModule } from './infra/health/health.module.js';
import { QueuesModule } from './infra/queue/queue.module.js';
import { RedisCacheModule } from './infra/redis/redis.module.js';
import { SchedulesModule } from './infra/schedule/schedule.module.js';
import { EventsPublisherModule } from './notifications/events/events-publisher.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { UsersModule } from './users/users.module.js';

export interface AppModuleOptions {
  /** Overrides `Bun.env`. Suites pass a literal rather than mutating the process. */
  readonly source?: ConfigSource;
  /** `fatal` in tests, so a suite does not print one JSON line per assertion. */
  readonly logLevel?: 'verbose' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
}

/**
 * Everything shared by the serving process and a sandboxed job child.
 *
 * Import order is construction order and shutdown runs in reverse, so config is
 * first and the database closes last. Nothing here is conditional on a service being
 * reachable: an absent Redis degrades a route, never the graph.
 */
class Foundation {
  static for(
    options: AppModuleOptions,
    publisher: 'socket' | 'relay',
  ): readonly ModuleRef[] {
    return [
      AppConfigModule.forRoot(
        options.source === undefined ? {} : { source: options.source },
      ),
      Foundation.#logging(options),
      DatabaseModule,
      RedisCacheModule,
      StorageModule,
      ImagesConfigModule,
      // Not armed in a job child: bullmq forks one per burst, so a schedule there
      // would fire in two or three processes at once.
      SchedulesModule.forRoot({ enabled: publisher === 'socket' }),
      // One instance for both graphs: `GoogleService` paces itself against a
      // per-minute quota, and two clients would each think they had the allowance.
      AIModule,
      // The one thing the two graphs configure differently: `socket` publishes
      // through this server's `PubSub`, `relay` puts the frame on the Redis channel.
      EventsPublisherModule.forRoot({ publisher }),
    ];
  }

  static #logging(options: AppModuleOptions): ModuleRef {
    if (options.logLevel !== undefined) {
      return LoggerModule.forRoot({ level: options.logLevel });
    }

    return LoggerModule.forRootAsync(
      {
        useFactory: (config: AppConfigService) => {
          const app = config.get('app');
          const log = config.get('log');
          return {
            name: app.name,
            version: app.version,
            env: app.env,
            level: log.level,
            isDevelopment: app.nodeEnv !== 'production',
            maskFields: [...log.maskFields],
            filterEvents: [...log.filterEvents],
          };
        },
        inject: [AppConfigService] as const,
      },
      { captureGlobalErrors: true },
    );
  }
}

/**
 * The application. **One process**: it serves HTTP, holds the clock, owns the sockets
 * and consumes its own queues.
 *
 * There is no entrypoint that starts the consumer, because an entrypoint cannot
 * express the ordering: `QueueModule.forRoot({ consume: true })` stops the workers at
 * `onShutdown`, which runs in reverse construction order and therefore before the
 * connections the handlers use. Isolation is per handler - see `src/jobs.processor.ts`.
 *
 * **Undecorated, with a static factory**, because every option here varies: `source`
 * and `logLevel` per suite, and `CLIENT_DIST` decides whether `ClientModule` is in the
 * graph at all. A `@Module` on top would compose, but it has no default to state.
 */
export class AppModule {
  static forRoot(options: AppModuleOptions = {}): DynamicModule {
    // Straight from the environment: this decides whether a *module* is in the
    // graph, and the graph is built before anything in it can be injected.
    const clientDist = (options.source ?? Bun.env)['CLIENT_DIST'];

    return {
      module: AppModule,
      imports: [
        ...Foundation.for(options, 'socket'),
        QueuesModule.forRoot(),
        // After DatabaseModule, so better-auth reuses the connection it opened.
        AccountsModule,
        ProfileModule,
        NotificationsModule,
        ServiceModule,
        UsersModule,
        FilesFeatureModule.forRoot(),
        // Last: the engine's `onInit` recovers the in-flight round and needs the
        // queue, the database and Redis all constructed before it runs.
        GameModule,
        ...(typeof clientDist === 'string' && clientDist.length > 0
          ? [ClientModule.forRoot(clientDist)]
          : []),
        AppModule.#throttle(),
      ],
    };
  }

  /**
   * Registered here rather than in `Foundation.for()`: `ClientAddress` is an HTTP
   * binding, a job child has no server, and nothing in a child answers a request to
   * limit.
   *
   * `store` is explicit because the default is `MemoryThrottleStore`, which
   * **counts** when Redis is unreachable rather than standing aside. Only
   * `RedisThrottleStore` can fail - and failing is what the guard reads as
   * "allow", which is this app's posture everywhere: an absent Redis degrades a
   * route, never the process.
   *
   * `subject` is an option rather than an injected caller because `@dunx/http`
   * must not depend on `@dunx/auth`. It is why `ThrottleGuard` is listed after
   * `SessionGuard` in `http.options.ts`: ahead of it, every caller is an address.
   */
  static #throttle(): DynamicModule {
    return ThrottleModule.forRootAsync({
      useFactory: (
        config: AppConfigService,
        redis: RedisConnection,
        caller: CurrentUser,
        address: ClientAddress,
      ) => ({
        ...config.get('throttle'),
        store: new RedisThrottleStore(redis),
        // No `?? 'anonymous'`: the guard already substitutes that for an
        // undefined subject, and saying it twice invites the two to disagree.
        subject: (req: BunRequest) => caller.optional()?.id ?? address.of(req),
      }),
      inject: [
        AppConfigService,
        RedisConnection,
        CurrentUser,
        ClientAddress,
      ] as const,
    });
  }
}

/**
 * The graph a **sandboxed job child** boots, and nothing else builds it.
 *
 * No `GameModule`: only the notification and media queues are sandboxed, and a child
 * that built `CrashEngineService` would be a second clock. No controllers and
 * `publisher: 'relay'`, because there is no server here to publish a frame through.
 * No `consume` - the child *is* the consumer.
 */
export class JobsModule {
  static forRoot(options: AppModuleOptions = {}): DynamicModule {
    return {
      module: JobsModule,
      imports: [
        ...Foundation.for(options, 'relay'),
        QueuesModule.forRoot({ controllers: false }),
        NotificationsModule,
        FilesFeatureModule.forRoot({ controllers: false }),
      ],
    };
  }
}
