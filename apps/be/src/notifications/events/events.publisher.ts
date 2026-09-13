import { Logger } from '@dunx/core';
import { PubSub, RelayPublisher, WsRelay } from '@dunx/http';
import { RedisConnection } from '@dunx/infra/redis';
import { AppConfigService } from '../../config/app.config.service.js';

/**
 * How a socket event leaves the process it was produced in. One token with two
 * bindings, because a job handler runs in **two containers**: the web process has a
 * `PubSub`, and a sandbox child has no server for one to exist in.
 *
 * An abstract class rather than an interface, because a dunx constructor parameter
 * must name something that exists at runtime.
 */
export abstract class EventsPublisher {
  abstract publish(topic: string, event: string, data: unknown): void;
}

/**
 * The web binding. `PubSub` publishes to this process's sockets and, when a relay
 * is configured, forwards the frame to every other node.
 */
export class SocketPublisher extends EventsPublisher {
  constructor(
    private readonly pubsub: PubSub,
    private readonly logger: Logger,
  ) {
    super();
  }

  /**
   * **Never throws**, the same rule `WorkerPublisher` keeps. A frame is best-effort;
   * a database transition is not. `publishEvent` throws once the server has stopped,
   * so a handler publishing after its commit would fail work it had already done -
   * bullmq retries, the commit happens twice, and for `game.round.schedule` that is
   * a duplicate round. `warn` rather than swallowed, since it is still a problem.
   */
  override publish(topic: string, event: string, data: unknown): void {
    try {
      this.pubsub.publishEvent(topic, event, data);
    } catch (error) {
      this.logger.warn('socket frame not published', {
        topic,
        event,
        reason: (error as Error).message,
      });
    }
  }
}

/**
 * The cache module's `RedisConnection`, as the relay contract dunx's publisher
 * takes. `RedisConnection` already publishes and subscribes; what it does not have
 * is `close`, and that is deliberate here - the connection belongs to
 * `RedisCacheModule`, which closes it at shutdown, and a second owner closing it
 * would take the cache down with the fan-out.
 *
 * The alternative was importing `WsRelayModule` into the worker graph, which opens
 * a second Redis client per forked job child for one publish.
 */
class CacheConnectionRelay extends WsRelay {
  constructor(private readonly redis: RedisConnection) {
    super();
  }

  override publish(channel: string, message: string): Promise<number> {
    return this.redis.publish(channel, message);
  }

  override subscribe(
    channel: string,
    listener: (message: string) => void,
  ): Promise<void> {
    return this.redis.subscribe(channel, listener);
  }

  override close(): void {}
}

/**
 * The worker binding: straight onto the relay channel, so a process with no server
 * can hand a frame to every process that has one.
 *
 * The encoding is `@dunx/http`'s, through its `RelayPublisher`: a local copy of a
 * wire format the framework owns is a fan-out that breaks silently on a bump.
 */
export class WorkerPublisher extends EventsPublisher {
  readonly #frames: RelayPublisher;

  constructor(redis: RedisConnection, config: AppConfigService) {
    super();
    this.#frames = new RelayPublisher(new CacheConnectionRelay(redis), {
      channel: config.get('ws').relayChannel,
    });
  }

  /**
   * **Never throws**, the same rule `SocketPublisher` keeps, and `RelayPublisher`
   * is what holds it: a worker must not fail a job because no web node is
   * listening, and with no Redis at all there is nothing to fan out to anyway.
   */
  override publish(topic: string, event: string, data: unknown): void {
    this.#frames.publishEvent(topic, event, data);
  }
}
