import { Module } from '@dunx/core';
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
 * `dirname(':memory:')` is `'.'`, which would measure whatever the process was
 * started from - and for an in-memory database the cwd is the honest answer anyway:
 * there is no data volume to run out of.
 */
const volumeOf = (config: AppConfigService): string => {
  const { sqlitePath } = config.get('db');
  return sqlitePath === ':memory:' ? '.' : dirname(sqlitePath);
};

/** Hoisted, so the decorator below can name it: a `const` runs first. */
const health = HealthModule.forRootAsync({
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
            path: volumeOf(config),
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
});

/**
 * Liveness, readiness and build info. `critical: false` is the `degraded` bucket -
 * only the database can fail readiness.
 *
 * `Readiness` implements `OnBeforeShutdown`, which runs while the server is still
 * accepting: an `onShutdown` hook runs after `server.stop()`, so a probe answering
 * from there answers on a closed socket. Liveness keeps passing while draining,
 * because a pod shutting down does not need killing.
 */
@Module({
  imports: [health],
  // No `providers` for the indicators: they are values the factory hands to
  // `HealthOptions`, not injectables. Binding them would build a second copy.
  controllers: [ServiceController],
})
export class ServiceModule {}
