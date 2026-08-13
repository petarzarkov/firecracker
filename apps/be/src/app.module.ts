import type { ConfigSource, DynamicModule, ModuleRef } from '@dunx/core';
import { LoggerModule } from '@dunx/infra/logger';
import { AccountsModule } from './auth/auth.module.js';
import { AppConfigModule } from './config/app.config.module.js';
import { ClientModule } from './client/client.module.js';
import { AppConfigService } from './config/app.config.service.js';
import { GameModule } from './game/game.module.js';
import { DatabaseModule } from './infra/db/database.module.js';
import { HealthModule } from './infra/health/health.module.js';
import { QueuesModule } from './infra/queue/queue.module.js';
import { RedisCacheModule } from './infra/redis/redis.module.js';
import { ThrottleGuard } from './infra/redis/guards/throttle.guard.js';
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
 * Everything shared by the web process and the worker: config, logging, the
 * database, Redis and the queue's publish side.
 *
 * Import order is construction order, and shutdown runs in reverse. Config comes
 * first because everything else reads it, then logging, then the database, whose
 * connection therefore closes last.
 *
 * **Nothing here is conditional on a service being reachable.** Every connection is
 * lazy, so an absent Redis cannot stop the graph from building - what degrades is
 * the route that needs it. The crash engine is the one exception worth naming: with
 * no Redis there is no queue, so rounds never advance. That is a dead game rather
 * than a dead process, and it is visible on the health endpoint.
 */
const foundation = (
  options: AppModuleOptions,
  publisher: 'socket' | 'relay',
): readonly ModuleRef[] => [
  AppConfigModule.forRoot(
    options.source === undefined ? {} : { source: options.source },
  ),
  options.logLevel === undefined
    ? LoggerModule.forRootAsync(
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
      )
    : LoggerModule.forRoot({ level: options.logLevel }),
  DatabaseModule.forRoot(),
  RedisCacheModule.forRoot(),
  // One binding per process, and the one thing the two processes configure
  // differently: `socket` publishes through this server's `PubSub`, `relay` puts
  // the frame straight on the Redis channel every web node is listening to.
  EventsPublisherModule.forRoot({ publisher }),
];

/**
 * The web process's graph.
 *
 * **Undecorated, with a static factory** - the same shape every configurable module
 * in dunx uses, `DbModule.forRoot()` and `QueueModule.forRootAsync()` included. It
 * must not *also* carry `@Module`: `resolveRef` in `@dunx/core` concatenates a
 * `DynamicModule`'s options with any decorator metadata on the class it names rather
 * than overriding them, so declaring both registers every import twice.
 *
 * Decorate or configure, never both. A module that takes **no** options should be
 * decorated instead, as `AccountsModule` is: a class is one reference however many
 * modules import it, and a factory returning a fresh object per call is a fresh
 * scope per call.
 */
export class AppModule {
  static forRoot(options: AppModuleOptions = {}): DynamicModule {
    // Read straight from the environment rather than the container: this decides
    // whether a *module* is in the graph, and the graph is built before anything
    // in it can be injected.
    const clientDist = (options.source ?? Bun.env)['CLIENT_DIST'];

    return {
      module: AppModule,
      imports: [
        ...foundation(options, 'socket'),
        QueuesModule.forRoot(),
        // After DatabaseModule, so better-auth reuses the connection it opened.
        AccountsModule,
        NotificationsModule.forRoot(),
        HealthModule,
        UsersModule,
        // Last: the engine's `onInit` recovers the in-flight round and needs the
        // queue, the database and Redis all constructed before it runs.
        GameModule.forRoot(),
        ...(typeof clientDist === 'string' && clientDist.length > 0
          ? [ClientModule.forRoot(clientDist)]
          : []),
      ],
      /**
       * `ThrottleGuard` limits every route, tuned per route by `@Throttle`
       * metadata. That is the global-guard-plus-metadata shape, and splitting it
       * per feature would mean a rate limiter each feature could forget.
       */
      providers: [ThrottleGuard],
    };
  }
}

/**
 * The consuming half. A worker is its own container: it builds only what a handler
 * needs, has no HTTP server and therefore no `PubSub`, which is why the events
 * publisher is the relay one here.
 *
 * `QueuesModule` without its controller, because there are no routes to serve, and
 * no `AccountsModule` because a job has no caller.
 *
 * `GameModule.forRoot({ engine: false })` is the load-bearing difference. The round
 * *lifecycle* handlers must exist here - they are the jobs this process consumes -
 * but the tick loop must not: two processes both ticking would publish two crash
 * jobs per round. The web process owns the engine, the worker owns the transitions,
 * and they talk over Redis pub/sub.
 */
export class WorkerModule {
  static forRoot(options: AppModuleOptions = {}): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ...foundation(options, 'relay'),
        QueuesModule.forRoot({ controllers: false }),
        NotificationsModule.forRoot(),
        GameModule.forRoot({ engine: false, controllers: false }),
      ],
    };
  }
}
