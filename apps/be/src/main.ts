import { Logger } from '@dunx/core';
import { HttpFactory, type HttpApp } from '@dunx/http';
import { OpenApiExplorer, OpenApiModule } from '@dunx/openapi';
import { AppModule } from './app.module.js';
import { AuthDocument } from './auth/auth.document.js';
import { AUTH_MOUNT } from './auth/auth.options.js';
import { AppConfigService } from './config/app.config.service.js';
import { EnvConfig } from './config/env.validation.js';
import { AppHttpOptions } from './http.options.js';
import { HEALTH_ROUTES, SERVICE_ROUTES } from './constants.js';

/**
 * Boot, and nothing else. What used to be conditional out here now belongs to a
 * module: the client is two middlewares in `AppHttpOptions`, the queues are
 * `consume: true`, and the shutdown watchdog is `enableShutdownHooks`.
 */
const main = async (): Promise<void> => {
  /**
   * Validated here as well as inside `ConfigModule`, because `HttpOptions` is an
   * argument to the call that *builds* the container and so cannot inject anything.
   * Pure over the environment, so twice cannot disagree.
   */
  const boot = EnvConfig.validate(Bun.env);

  const app = await HttpFactory.create(
    OpenApiModule.forRootAsync({
      root: AppModule.forRoot(),
      useFactory: (config: AppConfigService) => {
        const { app: meta, docs } = config.values;
        return {
          title: meta.name,
          version: meta.version,
          description: meta.description,
          path: `/${docs.path}`,
          jsonPath: `/${docs.jsonPath}`,
          // Better Auth serves every endpoint from one wildcard route, so route
          // discovery sees none of them. Built from `boot` rather than the injected
          // `Auth` because openapi.config.ts shares it with no container at all.
          contribute: [AuthDocument.for(boot)],
        };
      },
      inject: [AppConfigService] as const,
    }),
    AppHttpOptions.for(boot),
  );

  const config = app.get(AppConfigService);
  const logger = app.get(Logger);
  const { app: appConfig, cors } = config.values;

  // The route table is built exactly once, at `listen()`. Calling any of these
  // afterwards throws rather than being quietly dropped.
  app.setGlobalPrefix(appConfig.prefix);
  app.set('trust proxy', cors.trustProxy);

  /**
   * `credentials: true` in every environment, and it used to be `isProd`.
   *
   * That condition was the reason a cross-origin dev client could not authenticate.
   * `@dunx/http` resolves `origin: '*'` by **reflecting the caller** when credentials
   * are allowed - a literal `*` is illegal alongside cookies and browsers reject it -
   * so with credentials off, the default `CORS_ORIGIN=*` answered `*` and every
   * credentialed request failed with "the wildcard is not allowed when the request's
   * credentials mode is 'include'". Turning it on in dev too makes the two behave the
   * same, which is the point of the setting.
   *
   * Development normally never reaches this: the client goes through Vite's proxy, so
   * it is same-origin and CORS does not apply.
   */
  app.enableCors({ origin: cors.origin, credentials: true });

  // Reflecting any origin *and* allowing credentials lets any site make authenticated
  // requests with a visitor's cookie. Fine behind a proxy that is the only caller;
  // a deployment reachable from a browser wants a real origin here.
  if (config.get('isProd') && cors.origin === '*') {
    logger.warn(
      'CORS_ORIGIN is "*" with credentials allowed, so any origin can make authenticated requests. Name the client origin instead.',
    );
  }

  /**
   * One call for the whole sequence: `onBeforeShutdown` fails readiness and holds it
   * failing for `HEALTH_DRAIN_DELAY_MS`, then the server stops accepting, then
   * providers tear down in reverse order - stopping the queue workers before the
   * connections they use.
   *
   * This replaced a local `forceExitAfter()` watchdog. bullmq's Bun adapter cannot
   * cancel a pending reconnect, so a process that touched an unreachable broker
   * survives a successful shutdown; core's timer is `unref`'d, so a healthy process
   * still exits immediately and it never fires.
   */
  app.enableShutdownHooks();

  const { warnings } = app.get(OpenApiExplorer);
  if (warnings.length > 0) logger.warn('openapi schema warnings', { warnings });

  if (config.get('auth').usingDevSecret) {
    logger.warn(
      'BETTER_AUTH_SECRET is unset, using the development constant. Sessions are forgeable by anyone with this repository.',
    );
  }

  const url = await app.listen(appConfig.port);
  logger.info(`${appConfig.name} listening`, links(app, url, boot));

  await app.closed;
};

/** The boot banner. */
const links = (
  app: HttpApp,
  url: string,
  boot: ReturnType<typeof EnvConfig.validate>,
): Record<string, unknown> => {
  const api = `${url}${boot.app.prefix}`;
  const health = `${api}/${HEALTH_ROUTES.BASE}`;

  return {
    url,
    env: boot.app.env,
    docs: `${api}/${boot.docs.path}`,
    openapi: `${api}/${boot.docs.jsonPath}`,
    liveness: `${health}/${HEALTH_ROUTES.LIVENESS}`,
    readiness: `${health}/${HEALTH_ROUTES.READINESS}`,
    build: `${api}/${SERVICE_ROUTES.BASE}/${SERVICE_ROUTES.CONFIG}`,
    // `/ok`, not the bare mount: `@dunx/auth` mounts better-auth as `<basePath>/*`
    // and `Bun.serve`'s `/*` needs a segment, so nothing answers at the mount itself.
    // Printing the mount advertised a URL that 404'd.
    auth: `${api}${AUTH_MOUNT}/ok`,
    // Admin-only, so a browser with no session gets a 401 by design.
    queues: `${api}/queues`,
    websocket: app.gatewayPaths.map(
      (path) => `${url.replace('http', 'ws').replace(/\/$/, '')}${path}`,
    ),
    timezone: boot.app.timezone,
    versions: { bun: Bun.version, node: process.versions.node },
  };
};

// `.catch` rather than a top-level `await`, for the exit code: a boot that throws has
// to be a failed process, or an orchestrator reads a container that exited 0 and stops
// restarting it. `console.error` because there may be no container to get a Logger from.
main().catch((error: unknown) => {
  console.error('[firecracker] boot failed', error);
  process.exit(1);
});
