import { Module } from '@dunx/core';
import { RedisModule } from '@dunx/infra/redis';
import { AppConfigService } from '../../config/app.config.service.js';

/**
 * Registered unconditionally: `Bun.RedisClient` connects lazily, so nothing is
 * dialled here and an unavailable cache degrades a *route*, never the graph.
 *
 * `maxRetries: 0` is not impatience - on Bun 1.3.14 a client that failed to connect
 * with `maxRetries > 0` keeps a retry timer alive past `close()` and the process
 * never exits. `eager` stays `false` for the same reason.
 *
 * `global: true` and decorated like `DatabaseModule`: one client, built once.
 */
@Module({
  global: true,
  imports: [
    RedisModule.forRootAsync({
      useFactory: (config: AppConfigService) => {
        // Destructured first: `exactOptionalPropertyTypes` will not let a
        // `string | undefined` reach a `url?: string`, even inside the branch
        // that has already ruled `undefined` out.
        const { url, connectTimeoutMs } = config.get('redis');
        return {
          ...(url === undefined ? {} : { url }),
          connectionTimeout: connectTimeoutMs,
          maxRetries: 0,
        };
      },
      inject: [AppConfigService] as const,
    }),
  ],
  exports: [RedisModule],
})
export class RedisCacheModule {}
