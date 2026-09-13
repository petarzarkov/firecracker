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
import { HEALTH_ROUTES } from '../constants.js';
import { SpaFallback } from '../client/client.module.js';
import { AppConfigService } from '../config/app.config.service.js';
import { ErrorMapper } from '../core/errors/error-mapper.js';
import { SocketErrorReporter } from '../core/errors/socket-error.reporter.js';
import { SocketThrottle } from '../game/surface/socket-throttle.js';

/**
 * How this app configures its HTTP server, resolved from the container so it reads
 * the same validated config as everything else. An argument to `create()` still
 * wins field by field, which is how a suite turns request logging off without
 * restating the rest.
 *
 * **Override a field with a field and a getter with a getter** - TypeScript rejects
 * the other pairing with `TS2611` and `TS2610`.
 */
export class AppHttpOptions extends HttpOptionsProvider {
  override readonly middleware: readonly Ctor<Middleware>[];
  override readonly trustProxy: boolean;
  override readonly relayChannel: string;

  /**
   * `SocketThrottle` inside the reporter, so a refused frame is not an error and
   * never reaches it: a rate limit logging a line per frame moves the flood into
   * the log rather than stopping it.
   */
  override readonly socketMiddleware: readonly Ctor<SocketMiddleware>[] = [
    SocketErrorReporter,
    SocketThrottle,
  ];

  constructor(
    private readonly config: AppConfigService,
    // Bound by `WsRelayModule`, not constructed here: one built in the getter
    // would be a new relay per call and closed by nobody.
    private readonly bus: RedisRelay,
  ) {
    super();

    const { client, cors, ws } = config.values;

    /**
     * Outermost first, and the order is the whole point. `app.use()` appends, so
     * from there `Compression` would sit *inside* `StaticFiles`, which answers and
     * returns - and the client bundle, the largest thing this app serves, would
     * never be encoded. Behind the chain, serving a hashed asset cost a
     * `getSession` and a Redis `INCR`, and a cold page load spent its throttle
     * budget on its own JavaScript. `SpaFallback` outside `StaticFiles`, or the
     * static mount answers the deep link first. `SessionGuard` before
     * `ThrottleGuard`, so the throttler counts per user.
     *
     * The client pair only when this process serves the built client; in
     * development Vite does, and nothing static should shadow an API route.
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
      // Both stay `false` outside a debugging session: `requestBody` genuinely
      // includes the body, and `LOG_MASK_FIELDS` masks by field *name* - it
      // cannot save a sign-in body whose secret is not a name it knows.
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
