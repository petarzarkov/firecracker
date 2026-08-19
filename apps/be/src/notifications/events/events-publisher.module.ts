import { Logger, provide, type DynamicModule } from '@dunx/core';
import { PubSub } from '@dunx/http';
import { RedisConnection } from '@dunx/infra/redis';
import { AppConfigService } from '../../config/app.config.service.js';
import {
  EventsPublisher,
  RelayPublisher,
  SocketPublisher,
} from './events.publisher.js';

export interface EventsPublisherOptions {
  /**
   * `socket` in the web process, `relay` in the worker. The worker's container has
   * no `PubSub` - `HttpFactory` is what binds it - so a handler that published
   * through one would resolve nothing there.
   */
  readonly publisher: 'socket' | 'relay';
}

/**
 * One binding of `EventsPublisher` per process, `global: true`, built by
 * `foundation()`.
 *
 * ## Why this is its own module
 *
 * It used to be a provider inside `NotificationsModule`. That was fine while
 * notifications were the only thing publishing, and stopped being fine the moment
 * the game did too: `NotificationsModule.forRoot()` returns a **new object per
 * call**, so a second module importing it to reach `EventsPublisher` would get a
 * second scope with a second binding - the exact trap `app.module.ts` documents
 * about decorating and configuring the same module.
 *
 * Pulling the binding out is the fix that scales: both `NotificationsModule` and
 * `GameModule` now inject `EventsPublisher` and neither imports the other.
 */
export class EventsPublisherModule {
  static forRoot(options: EventsPublisherOptions): DynamicModule {
    const publisher =
      options.publisher === 'socket'
        ? provide(EventsPublisher, {
            useFactory: (pubsub: PubSub, logger: Logger) =>
              new SocketPublisher(pubsub, logger),
            inject: [PubSub, Logger] as const,
          })
        : provide(EventsPublisher, {
            useFactory: (redis: RedisConnection, config: AppConfigService) =>
              new RelayPublisher(redis, config),
            inject: [RedisConnection, AppConfigService] as const,
          });

    return {
      module: EventsPublisherModule,
      global: true,
      providers: [publisher],
      exports: [EventsPublisher],
    };
  }
}
