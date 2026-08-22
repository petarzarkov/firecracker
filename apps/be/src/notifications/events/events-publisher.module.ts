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
 * Its own module rather than a provider inside `NotificationsModule`, because both
 * that module and the game publish: a `forRoot()` returns a **new object per call**,
 * so the second importer reaching for `EventsPublisher` would get a second scope with
 * a second binding. As a global module both inject it and neither imports the other.
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
