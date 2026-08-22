import type { DynamicModule } from '@dunx/core';
import {
  HttpError,
  HttpStatusCode,
  StaticModule,
  UNMATCHED,
  type Middleware,
  type Next,
  type RouteContext,
} from '@dunx/http';
import type { BunRequest } from 'bun';
import { join } from 'node:path';
import { AppConfigService } from '../config/app.config.service.js';

/**
 * Answers a deep link with `index.html`. `StaticModule` serves the files but
 * deliberately not this: a middleware owning "what a 404 means" for paths it did
 * not mount will eventually swallow a real one, so the rewrite lives here where the
 * exclusions are known.
 */
export class SpaFallback implements Middleware {
  readonly #index: string;
  readonly #prefix: string;

  constructor(config: AppConfigService) {
    this.#index = join(config.get('client').dist ?? '', 'index.html');
    this.#prefix = `/${config.get('app').prefix}`;
  }

  /**
   * Rewrites an **unmatched GET that wanted HTML** to `index.html`.
   *
   * A miss arrives as a *throw*, not a 404 response - inspecting `(await
   * next()).status` never ran at all, and rewrote 404s a route had *returned*.
   * `UNMATCHED` is the difference: no real route sets it and every miss does, which
   * is what keeps a route's own "no such record" intact. GET only, so a POST to a
   * typo is not answered with a page; outside `/api` and `/ws`, so a mistyped API
   * path stays JSON; and only when the caller accepts HTML, so `curl` gets its 404.
   */
  async handle(
    req: BunRequest,
    ctx: RouteContext,
    next: Next,
  ): Promise<Response> {
    try {
      return await next();
    } catch (error) {
      if (
        !(error instanceof HttpError) ||
        error.status !== HttpStatusCode.NOT_FOUND ||
        ctx.get(UNMATCHED) !== true
      ) {
        throw error;
      }
      if (req.method !== 'GET') throw error;

      const { pathname } = new URL(req.url);
      if (pathname.startsWith(this.#prefix) || pathname.startsWith('/ws')) {
        throw error;
      }
      if (!(req.headers.get('accept') ?? '').includes('text/html')) throw error;

      const index = Bun.file(this.#index);
      if (!(await index.exists())) throw error;

      return new Response(index, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          // The document must not be cached: it carries the hashed asset names, and
          // a stale one points at bundles that no longer exist.
          'cache-control': 'no-cache',
        },
      });
    }
  }
}

/**
 * Registered only when `CLIENT_DIST` is set - the deployed shape. In development
 * Vite serves the client and this module is absent entirely, so nothing here can
 * shadow an API route.
 */
export class ClientModule {
  static forRoot(dist: string): DynamicModule {
    return {
      module: ClientModule,
      imports: [
        StaticModule.forRoot({
          root: dist,
          path: '/',
          // Vite emits `index-Aue2z3V_.js`: a content hash, so the name changes
          // whenever the bytes do and caching it forever is a promise that holds.
          immutable: (pathname) => /\.[-\w]{8,}\.(js|css)$/.test(pathname),
        }),
      ],
      providers: [SpaFallback],
      exports: [SpaFallback],
    };
  }
}
