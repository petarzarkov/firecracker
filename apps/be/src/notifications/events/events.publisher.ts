import { Logger } from '@dunx/core';
import { encode, encodeRelay, PubSub } from '@dunx/http';
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
   * **Never throws**, the same rule `RelayPublisher` keeps. A frame is best-effort;
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
 * The worker binding: straight onto the relay channel, in `@dunx/http`'s own wire
 * format, so a process with no server can hand a frame to every process that has
 * one. The origin is this process's id, which stops a node that also runs a worker
 * from fanning out its own frame twice.
 */
export class RelayPublisher extends EventsPublisher {
  readonly #origin = `worker:${Bun.randomUUIDv7()}`;
  readonly #channel: string;

  constructor(
    private readonly redis: RedisConnection,
    config: AppConfigService,
  ) {
    super();
    this.#channel = config.get('ws').relayChannel;
  }

  override publish(topic: string, event: string, data: unknown): void {
    const frame = encodeRelay(this.#origin, topic, encode(event, data));
    // Fire and forget: a worker must not fail a job because no web node is
    // listening, and with no Redis at all there is nothing to fan out to anyway.
    void this.redis.publish(this.#channel, frame).catch(() => undefined);
  }
}
