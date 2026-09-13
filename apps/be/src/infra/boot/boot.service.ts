import { Logger, Module, type OnInit } from '@dunx/core';
import { AuthOptions } from '@dunx/auth';
import { OpenApiExplorer } from '@dunx/openapi';
import type { HttpApp } from '@dunx/http';
import { AppConfigService } from '../../config/app.config.service.js';
import { HEALTH_ROUTES, SERVICE_ROUTES } from '../../constants.js';

/**
 * What `main.ts` used to say out loud between `create()` and `listen()`.
 *
 * A provider with `onInit`, so the warnings are a property of booting this graph
 * rather than of running this entrypoint - a spec that builds the app gets them
 * too, which is where a misconfiguration is cheapest to find.
 */
export class BootWarnings implements OnInit {
  constructor(
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  onInit(): void {
    const { app, auth, cors } = this.config.values;

    // Reflecting any origin *and* allowing credentials lets any site make
    // authenticated requests with a visitor's cookie.
    if (this.config.get('isProd') && cors.origin === '*') {
      this.logger.warn(
        'CORS_ORIGIN is "*" with credentials allowed, so any origin can make authenticated requests. Name the client origin instead.',
      );
    }

    if (auth.usingDevSecret) {
      this.logger.warn(
        'BETTER_AUTH_SECRET is unset, using the development constant. Sessions are forgeable by anyone with this repository.',
      );
    }

    /**
     * zod strips what it does not recognise, so a misspelled variable is
     * indistinguishable from one nobody set - `AI_GROK_API_KEY` beside a schema
     * saying `AI_GROQ_API_KEY` looks configured from every angle except the one
     * that matters. Warned rather than refused: a deploy that will not boot over
     * a stray variable is worse.
     */
    if (app.unreadEnv.length > 0) {
      this.logger.warn('environment variables set but not read by this app', {
        variables: app.unreadEnv,
      });
    }
  }
}

/**
 * The boot banner. Not an `onInit`: every link needs the bound port, which only
 * exists once `listen()` has resolved.
 */
export class BootBanner {
  constructor(
    private readonly config: AppConfigService,
    private readonly mount: AuthOptions,
    private readonly logger: Logger,
  ) {}

  announce(app: HttpApp, url: string): void {
    const { app: meta, docs } = this.config.values;

    /**
     * Read off the app rather than injected: `OpenApiModule` **wraps** the root,
     * so the document is bound in the scope above this one and a constructor
     * parameter here resolves nothing.
     */
    const { warnings } = app.get(OpenApiExplorer);
    if (warnings.length > 0) {
      this.logger.warn('openapi schema warnings', { warnings });
    }

    const api = `${url}${meta.prefix}`;
    const health = `${api}/${HEALTH_ROUTES.BASE}`;
    const ws = url.replace('http', 'ws').replace(/\/$/, '');

    this.logger.info(`${meta.name} listening`, {
      url,
      env: meta.env,
      docs: `${api}/${docs.path}`,
      openapi: `${api}/${docs.jsonPath}`,
      liveness: `${health}/${HEALTH_ROUTES.LIVENESS}`,
      readiness: `${health}/${HEALTH_ROUTES.READINESS}`,
      build: `${api}/${SERVICE_ROUTES.BASE}/${SERVICE_ROUTES.CONFIG}`,
      // `/ok`, not the bare mount: better-auth is mounted as `<basePath>/*` and
      // `Bun.serve`'s `/*` needs a segment, so the mount itself 404s.
      auth: `${this.mount.basePath}/ok`,
      // Admin-only, so a browser with no session gets a 401 by design.
      queues: `${api}/queues`,
      websocket: app.gatewayPaths.map((path) => `${ws}${path}`),
      timezone: meta.timezone,
      versions: { bun: Bun.version, node: process.versions.node },
    });
  }
}

@Module({ providers: [BootWarnings, BootBanner], exports: [BootBanner] })
export class BootModule {}
