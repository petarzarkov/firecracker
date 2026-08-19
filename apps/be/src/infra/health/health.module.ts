import type { DynamicModule } from '@dunx/core';
import { DbConnection } from '@dunx/infra/db';
import { JobPublisher, QueueOptions } from '@dunx/infra/queue';
import { RedisConnection } from '@dunx/infra/redis';
import {
  DatabaseIndicator,
  DiskIndicator,
  DiskOptions,
  HealthModule,
  MemoryIndicator,
  MemoryOptions,
} from '@dunx/http';
import { dirname } from 'node:path';
import { AppConfigService } from '../../config/app.config.service.js';
import { OptionalRedisIndicator, QueueIndicator } from './indicators.js';
import { ServiceController } from './service.controller.js';

/**
 * Liveness, readiness and build info.
 *
 * This replaced a hand-rolled Terminus envelope - four `#check*` methods, three status
 * buckets and an `at(status)` partitioner - with `@dunx/http`'s, which is better in two
 * ways this app was getting wrong: a check that times out is `unknown` rather than
 * `down`, and the checks run concurrently and bounded, where the old `check()` awaited
 * the cache then the queue unbounded and so hung on a Redis that went quiet instead of
 * failing.
 *
 * `critical: false` carries what `degraded` used to. Only the database can fail
 * readiness.
 *
 * `Readiness` implements `OnBeforeShutdown`, which runs while the server is still
 * accepting - an `onShutdown` hook runs after `server.stop()`, so a probe answering
 * from there answers on a closed socket. (The phase was `OnDrain` in 2.1.0 and was
 * renamed in 2.1.1: `@dunx/http` already had an unrelated `@OnDrain()` websocket
 * decorator.) Liveness keeps passing while draining, because a pod shutting down does
 * not need killing.
 */
export class ServiceModule {
  static forRoot(): DynamicModule {
    return {
      module: ServiceModule,
      imports: [
        HealthModule.forRootAsync({
          useFactory: (
            config: AppConfigService,
            db: DbConnection,
            redis: RedisConnection,
            publisher: JobPublisher,
            queue: QueueOptions,
          ) => {
            const service = config.get('service');
            return {
              // Liveness means "restart me", so only what is in-process belongs. The
              // heap ceiling is non-critical on the indicator: it reports a hot
              // process without asking to be killed for it.
              liveness: [
                new MemoryIndicator(
                  new MemoryOptions({
                    maxRssBytes: service.maxMemoryMb * 1024 * 1024,
                  }),
                ),
              ],
              // The disk is measured at the SQLite file's directory, because that is
              // the filesystem a write lands on and in production it is a volume.
              readiness: [
                new DatabaseIndicator(db),
                new OptionalRedisIndicator(redis),
                new QueueIndicator(publisher, queue),
                new DiskIndicator(
                  new DiskOptions({
                    path: ServiceModule.#volumeOf(config),
                    maxUsedFraction: service.maxDiskUsedFraction,
                  }),
                ),
              ],
              drainDelayMs: service.drainDelayMs,
            };
          },
          inject: [
            AppConfigService,
            DbConnection,
            RedisConnection,
            JobPublisher,
            QueueOptions,
          ] as const,
        }),
      ],
      // No `providers` for the indicators: they are values the factory hands to
      // `HealthOptions`, not injectables. Binding them would build a second copy.
      controllers: [ServiceController],
    };
  }

  /**
   * `dirname(':memory:')` is `'.'`, which would measure whatever the process was
   * started from - and for an in-memory database the cwd is the honest answer anyway:
   * there is no data volume to run out of.
   */
  static #volumeOf(config: AppConfigService): string {
    const { sqlitePath } = config.get('db');
    return sqlitePath === ':memory:' ? '.' : dirname(sqlitePath);
  }
}
