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
       * The socket's request log. `SocketLoggingMiddleware` wraps every dispatched
       * handler the way `RequestLoggingMiddleware` wraps a route, so the frame and
       * what it answered are one entry rather than two to correlate - and it carries
       * `connectionId`, which is the only thing that joins a frame to the connect and
       * the disconnect around it.
       *
       * Everything left at its default is left there deliberately. `debug` for a
       * frame and for connect/disconnect, because a socket is traffic and CLAUDE.md's
       * frequency contract puts traffic below `info`. **Payloads off**, because a
       * chat body, a DM and a bet amount all cross this socket and `LOG_MASK_FIELDS`
       * masks by field *name* - it cannot save a payload dumped wholesale.
       *
       * `gameTick` is the one event that must never reach the log. Nothing routes it
       * today, so a client that sent one would fall through to the unclaimed-frame
       * entry - and the tick is on a 100 ms clock, which is 864,000 lines a day per
       * socket if that ever became true.
       *
       * `errorLevel` is the one default overridden. A failed frame is still recorded
       * here, at the frame's own level, with the event on it - but the `error` entry
       * is `SocketErrorReporter`'s, so a single failure is not two lines an operator
       * has to notice are the same one.
       */
      socketLogging: {
        events: { [GAME_EVENTS.TICK]: false },
        errorLevel: LogLevel.DEBUG,
      },
      /**
       * Inside the logging middleware, which dunx puts outermost. It is where a
       * socket exception becomes an entry, and the reason there is no
       * `websocket.onError` beside it - see `SocketErrorReporter`.
       */
      socketMiddleware: [SocketErrorReporter],
      /**
       * Multi-node websocket fan-out.
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
