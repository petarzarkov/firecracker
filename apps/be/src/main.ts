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
 * Boot, and nothing else. Nothing here is conditional: the client is two middlewares
 * in `AppHttpOptions`, the queues are `consume: true`, and the shutdown watchdog is
 * `enableShutdownHooks`.
 */
const main = async (): Promise<void> => {
  // Validated here as well as in `ConfigModule`, because `HttpOptions` is an
  // argument to the call that *builds* the container. Pure over the environment,
  // so the two cannot disagree.
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

  // `credentials: true` in **every** environment, not just production. dunx resolves
  // `origin: '*'` by reflecting the caller only when credentials are allowed, so
  // with them off the default `CORS_ORIGIN=*` answers a literal `*`, which a browser
  // rejects for any credentialed request. Development usually never reaches this,
  // since the client goes through Vite's proxy and is same-origin.
  app.enableCors({ origin: cors.origin, credentials: true });

  // Reflecting any origin *and* allowing credentials lets any site make authenticated
  // requests with a visitor's cookie. Fine behind a proxy that is the only caller;
  // a deployment reachable from a browser wants a real origin here.
  if (config.get('isProd') && cors.origin === '*') {
    logger.warn(
      'CORS_ORIGIN is "*" with credentials allowed, so any origin can make authenticated requests. Name the client origin instead.',
    );
  }

  // The whole sequence: readiness fails and stays failing for
  // `HEALTH_DRAIN_DELAY_MS`, then the server stops accepting, then providers tear
  // down in reverse - queue workers before the connections they use. The timer
  // behind it is `unref`'d, so a healthy process still exits immediately.
  app.enableShutdownHooks();

  const { warnings } = app.get(OpenApiExplorer);
  if (warnings.length > 0) logger.warn('openapi schema warnings', { warnings });

  if (config.get('auth').usingDevSecret) {
    logger.warn(
      'BETTER_AUTH_SECRET is unset, using the development constant. Sessions are forgeable by anyone with this repository.',
    );
  }

  /**
   * A setting that is on and is not.
   *
   * zod strips what it does not recognise, so a misspelled variable is indis-
   * tinguishable from one nobody set - and `AI_GROK_API_KEY` next to a schema that
   * says `AI_GROQ_API_KEY` looks configured from every angle except the one that
   * matters. Warned rather than refused: an environment is not ours to be strict
   * about, and a deploy that will not boot over a stray variable is worse.
   */
  if (appConfig.unreadEnv.length > 0) {
    logger.warn('environment variables set but not read by this app', {
      variables: appConfig.unreadEnv,
    });
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
    // `/ok`, not the bare mount: better-auth is mounted as `<basePath>/*` and
    // `Bun.serve`'s `/*` needs a segment, so the mount itself 404s.
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

// `.catch` rather than a top-level `await`, for the exit code: a boot that throws
// must be a failed process, or an orchestrator sees a container that exited 0 and
// stops restarting it. `console.error` because there may be no container yet.
main().catch((error: unknown) => {
  console.error('[firecracker] boot failed', error);
  process.exit(1);
});
