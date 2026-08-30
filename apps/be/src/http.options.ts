import { SessionGuard } from '@dunx/auth';
import {
  Compression,
  HttpOptionsProvider,
  RedisRelay,
  StaticFiles,
  ThrottleGuard,
  WsRelayModule,
  type CorsOptions,
  type ErrorHandler,
  type Middleware,
  type PubSubRelay,
  type RequestLoggingOptions,
  type SocketLoggingOptions,
  type SocketMiddleware,
  type SocketOptions,
} from '@dunx/http';
import { LogLevel, Module, provide, type Ctor } from '@dunx/core';
import { GAME_EVENTS } from '@firecracker/contracts';
import { HEALTH_ROUTES } from './constants.js';
import { SpaFallback } from './client/client.module.js';
import { AppConfigService } from './config/app.config.service.js';
import { ErrorMapper } from './core/errors/error-mapper.js';
import { SocketErrorReporter } from './core/errors/socket-error.reporter.js';
import { SocketThrottle } from './game/surface/socket-throttle.js';

/**
 * How this app configures its HTTP server, **resolved from the container**.
 *
 * It used to be a static returning an `HttpOptions`, called once by `main.ts` and
 * again by every spec - because `HttpFactory.create(root, options)` takes its
 * options *before* the container exists, so nothing here could inject. `main.ts`
 * paid for that with a second `EnvConfig.validate(Bun.env)` beside the one
 * `ConfigModule` already does, and each suite paid by restating the production
 * options or silently testing a server with no guards.
 *
 * dunx 3.1.0 resolves this provider *after* the container and before the route
 * table, so it reads the same validated config every other provider does. An
 * argument to `create()` still wins field by field, which is how a suite turns
 * request logging off without restating anything else.
 *
 * **Override a field with a field and a getter with a getter** - TypeScript rejects
 * the other pairing with `TS2611` and `TS2610`. The four fields below derive from
 * config, so they are assigned in the constructor rather than declared with an
 * initialiser.
 */
export class AppHttpOptions extends HttpOptionsProvider {
  override readonly middleware: readonly Ctor<Middleware>[];
  override readonly trustProxy: boolean;
  override readonly relayChannel: string;

  /**
   * Inside the logging middleware, which dunx puts outermost - which is why there
   * is no `websocket.onError` beside it. See `SocketErrorReporter`.
   *
   * `SocketThrottle` is inside the reporter, so a refused frame is not an error and
   * never reaches it: a rate limit that logged a line per frame would move the flood
   * into the log rather than stopping it.
   */
  override readonly socketMiddleware: readonly Ctor<SocketMiddleware>[] = [
    SocketErrorReporter,
    SocketThrottle,
  ];

  constructor(
    private readonly config: AppConfigService,
    /**
     * Bound by `WsRelayModule` rather than constructed here. A relay built in this
     * getter would be a new one per call and closed by nobody; the container closes
     * this one at shutdown, which `PubSub.close()` does not do for an app that
     * never opened a socket.
     */
    private readonly bus: RedisRelay,
  ) {
    super();

    const { client, cors, ws } = config.values;

    /**
     * Outermost first, after the built-in request logger.
     *
     * The client pair belongs here rather than in `app.use()`, which appends:
     * behind the chain, serving a hashed asset off disk cost a `getSession` and a
     * Redis `INCR`, and a cold page load spent its throttle budget on its own
     * JavaScript. `SpaFallback` outside `StaticFiles`, or the static mount answers
     * the deep link first. `SessionGuard` next, so the throttler can count per user.
     *
     * `Compression` ahead of all of it, which is the whole reason it is in this
     * array rather than in the `app.use(Compression)` the docs show: `use()`
     * appends, and from there it would sit *inside* `StaticFiles`, which answers
     * and returns - so the client bundle, the largest thing this app serves, would
     * never be encoded. It still runs inside dunx's request logger, so the logged
     * status is the real one.
     *
     * Only when this process serves the built client. Unset in development, where
     * Vite serves it and nothing static should be able to shadow an API route.
     */
    this.middleware = [
      Compression,
      ...(client.dist === undefined ? [] : [SpaFallback, StaticFiles]),
      SessionGuard,
      ThrottleGuard,
    ];

    this.trustProxy = cors.trustProxy;
    this.relayChannel = ws.relayChannel;
  }

  override get prefix(): string {
    return this.config.get('app').prefix;
  }

  /**
   * `credentials: true` in **every** environment, not just production. dunx
   * resolves `origin: '*'` by reflecting the caller only when credentials are
   * allowed, so with them off the default `CORS_ORIGIN=*` answers a literal `*`,
   * which a browser rejects for any credentialed request. Development usually never
   * reaches this, since the client goes through Vite's proxy and is same-origin.
   *
   * `main.ts` warns when this pairs `*` with a production deploy.
   */
  override get cors(): CorsOptions {
    return { origin: this.config.get('cors').origin, credentials: true };
  }

  override get onError(): ErrorHandler {
    return ErrorMapper.toResponseBody;
  }

  override get websocket(): SocketOptions {
    return { idleTimeout: 60 };
  }

  override get relay(): PubSubRelay {
    return this.bus;
  }

  override get requestLogging(): RequestLoggingOptions {
    const log = this.config.get('log');
    return {
      // Both default to `false` and should stay there outside a debugging session:
      // as of dunx 2.4.0 `requestBody` genuinely includes the body, and
      // `LOG_MASK_FIELDS` masks by field *name* - it cannot save a sign-in body
      // whose secret is not one of the names it knows.
      requestBody: log.requestBody,
      responseBody: log.responseBody,
      ignore: this.#probePaths(),
    };
  }

  override get socketLogging(): SocketLoggingOptions {
    return {
      // The tick is on a 100 ms clock: 864,000 lines a day per socket if anything
      // ever routed it, including the unclaimed-frame entry it falls through to.
      events: { [GAME_EVENTS.TICK]: false },
      // The `error` entry for a failed frame is `SocketErrorReporter`'s, so
      // demoting this one stops a single failure being two lines.
      errorLevel: LogLevel.DEBUG,
    };
  }

  /** The orchestrator's two paths, kept out of the request log. */
  #probePaths(): readonly string[] {
    const base = `/${this.config.get('app').prefix}/${HEALTH_ROUTES.BASE}`;
    return [
      `${base}/${HEALTH_ROUTES.LIVENESS}`,
      `${base}/${HEALTH_ROUTES.READINESS}`,
    ];
  }
}

/**
 * `global: true` so `HttpFactory` finds the binding wherever the root ends up -
 * `main.ts` wraps `AppModule` in `OpenApiModule.forRootAsync`, and the options are
 * resolved from *that* module's scope.
 *
 * Imported only by `AppModule`, never by `Foundation.for()`: a sandboxed job child
 * has no server to configure, and `WsRelayModule` there would open a second Redis
 * subscriber per fork.
 *
 * Never conditional: with no Redis the relay degrades to single-process fan-out and
 * the app still boots.
 */
@Module({
  global: true,
  imports: [
    WsRelayModule.forRootAsync({
      useFactory: (config: AppConfigService) => {
        // Destructured first: `exactOptionalPropertyTypes` will not let a
        // `string | undefined` reach a `url?: string`, even inside the branch that
        // has already ruled `undefined` out.
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
  providers: [provide(HttpOptionsProvider, { useClass: AppHttpOptions })],
  exports: [HttpOptionsProvider],
})
export class HttpConfigModule {}
