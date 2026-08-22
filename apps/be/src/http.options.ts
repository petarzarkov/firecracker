import { SessionGuard } from '@dunx/auth';
import {
  RedisRelay,
  StaticFiles,
  ThrottleGuard,
  type HttpOptions,
  type Middleware,
} from '@dunx/http';
import { LogLevel, type Ctor } from '@dunx/core';
import { GAME_EVENTS } from '@firecracker/contracts';
import { HEALTH_ROUTES } from './constants.js';
import { SpaFallback } from './client/client.module.js';
import type { AppConfig } from './config/env.validation.js';
import { ErrorMapper } from './core/errors/error-mapper.js';
import { SocketErrorReporter } from './core/errors/socket-error.reporter.js';

/**
 * One place, because these go to `HttpFactory.create` **and** to `createTestServer`
 * - neither reads them off the container, and a suite that forgets them gets a
 * server with no guards and no error mapper that still boots and still answers.
 */
export class AppHttpOptions {
  static for(config: AppConfig): HttpOptions {
    return {
      middleware: AppHttpOptions.#middleware(config),
      onError: ErrorMapper.toResponseBody,
      // A miss answers 404, not the guard's 401. dunx defaults to `'guarded'` to stop
      // route enumeration; the route table is in a public OpenAPI document anyway,
      // and guarding a miss puts a database round trip on every one.
      notFound: 'public',
      requestLogging: {
        requestBody: config.log.requestBody,
        responseBody: config.log.responseBody,
        ignore: AppHttpOptions.#probePaths(config),
      },
      websocket: { idleTimeout: 60 },
      socketLogging: {
        // The tick is on a 100 ms clock: 864,000 lines a day per socket if anything
        // ever routed it, including the unclaimed-frame entry it falls through to.
        events: { [GAME_EVENTS.TICK]: false },
        // The `error` entry for a failed frame is `SocketErrorReporter`'s, so
        // demoting this one stops a single failure being two lines.
        errorLevel: LogLevel.DEBUG,
      },
      // Inside the logging middleware, which dunx puts outermost - which is why
      // there is no `websocket.onError` beside it. See `SocketErrorReporter`.
      socketMiddleware: [SocketErrorReporter],
      // Never conditional: with no Redis this degrades to single-process fan-out and
      // the app still boots.
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
   * The client pair belongs here rather than in `app.use()`, which appends: behind
   * the chain, serving a hashed asset off disk cost a `getSession` and a Redis
   * `INCR`, and a cold page load spent its throttle budget on its own JavaScript.
   * `SpaFallback` outside `StaticFiles`, or the static mount answers the deep link
   * first. `SessionGuard` next, so the throttler can count per user.
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
