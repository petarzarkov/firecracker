import { SessionGuard } from '@dunx/auth';
import {
  RedisRelay,
  StaticFiles,
  ThrottleGuard,
  type HttpOptions,
  type Middleware,
} from '@dunx/http';
import type { Ctor } from '@dunx/core';
import { HEALTH_ROUTES } from './constants.js';
import { SpaFallback } from './client/client.module.js';
import type { AppConfig } from './config/env.validation.js';
import { ErrorMapper } from './core/errors/error-mapper.js';

/**
 * The `HttpOptions`, in one place, because they go to `HttpFactory.create` **and** to
 * `@dunx/testing`'s `createTestServer` - neither reads them off the container. A suite
 * that forgets them gets a server with no guards and no error mapper, which still
 * boots and still answers, so the omission is silent.
 */
export class AppHttpOptions {
  static for(config: AppConfig): HttpOptions {
    return {
      middleware: AppHttpOptions.#middleware(config),
      onError: ErrorMapper.toResponseBody,
      /**
       * A path that matched nothing answers **404**, not the session guard's 401.
       * `@dunx/http` defaults to `'guarded'` so a miss cannot be used to enumerate
       * routes; this opts out because `GET /api/queue` answering `401 UNAUTHENTICATED`
       * says "log in" when the truth is "no such route", and because `SessionGuard`
       * puts a database round trip on every miss. The route table is in a public
       * OpenAPI document anyway.
       */
      notFound: 'public',
      requestLogging: {
        requestBody: config.log.requestBody,
        responseBody: config.log.responseBody,
        ignore: AppHttpOptions.#probePaths(config),
      },
      websocket: { idleTimeout: 60 },
      /**
       * Multi-node websocket fan-out - what `@socket.io/redis-adapter` was for.
       * Always configured, never conditional: with no Redis it degrades to the
       * single-process behaviour and the app still boots. It cannot read config off
       * the container for the same reason the port cannot.
       */
      relay: new RedisRelay({
        ...(config.redis.url === undefined ? {} : { url: config.redis.url }),
        connectionTimeout: config.redis.connectTimeoutMs,
        maxRetries: 0,
      }),
      relayChannel: config.ws.relayChannel,
    };
  }

  /**
   * Outermost first, after the built-in request logger.
   *
   * **The client pair belongs here rather than in two `app.use()` calls.** `use()`
   * appends to whatever this array declares, so every request for a hashed asset ran
   * the whole chain first - a better-auth `getSession` and a Redis `INCR` - to serve a
   * file off disk, and a cold page load spent its throttle budget on its
   * own JavaScript. `SpaFallback` outside `StaticFiles`, because it rewrites a 404 and
   * inside it the static mount answers the deep link first.
   *
   * Then `SessionGuard`, because everything after it wants to know who is calling: it
   * runs the rest inside `AuthContext`, which is what lets the throttler count per
   * user rather than per address.
   */
  static #middleware(config: AppConfig): readonly Ctor<Middleware>[] {
    return [
      // Only when this process serves the built client. Unset in development, where
      // Vite serves it and nothing static should be able to shadow an API route.
      ...(config.client.dist === undefined ? [] : [SpaFallback, StaticFiles]),
      SessionGuard,
      ThrottleGuard,
    ];
  }

  /** The orchestrator's two paths, kept out of the request log. */
  static #probePaths(config: AppConfig): readonly string[] {
    const base = `/${config.app.prefix}/${HEALTH_ROUTES.BASE}`;
    return [
      `${base}/${HEALTH_ROUTES.LIVENESS}`,
      `${base}/${HEALTH_ROUTES.READINESS}`,
    ];
  }
}
