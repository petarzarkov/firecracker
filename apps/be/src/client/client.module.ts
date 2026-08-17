import type { DynamicModule } from '@dunx/core';
import {
  HttpStatusCode,
  StaticModule,
  type Middleware,
  type Next,
  type RouteContext,
} from '@dunx/http';
import type { BunRequest } from 'bun';
import { join } from 'node:path';
import { AppConfigService } from '../config/app.config.service.js';

/**
 * Serves the built client, and answers a deep link with `index.html`.
 *
 * This is what `ServeStaticModule` did in the NestJS version. `@dunx/http`'s
 * `StaticModule` covers the file serving; what it deliberately does not do is the
 * SPA rewrite, on the reasoning that a middleware which owns "what a 404 means"
 * for paths it did not mount is a middleware that will eventually swallow a real
 * one. So the rewrite is here, in the app, where the exclusions are known.
 */
export class SpaFallback implements Middleware {
  readonly #index: string;
  readonly #prefix: string;

  constructor(config: AppConfigService) {
    this.#index = join(config.get('client').dist ?? '', 'index.html');
    this.#prefix = `/${config.get('app').prefix}`;
  }

  /**
   * Runs the chain, and rewrites only a **404 on a GET that wanted HTML**.
   *
   * Each of those three conditions is load-bearing:
   *
   *  - Only a 404, so a real route's own 404 for a missing record is never
   *    replaced by a page saying nothing is wrong.
   *  - Only outside `/api` and `/ws`, so a mistyped API path still answers 404 as
   *    JSON rather than handing a client 200 and a pile of HTML to parse.
   *  - Only when the caller accepts HTML, so `fetch('/nope')` and `curl` get the
   *    404 they asked for while a browser address bar gets the app.
   */
  async handle(
    req: BunRequest,
    _ctx: RouteContext,
    next: Next,
  ): Promise<Response> {
    const response = await next();
    if (response.status !== HttpStatusCode.NOT_FOUND) return response;
    if (req.method !== 'GET') return response;

    const { pathname } = new URL(req.url);
    if (pathname.startsWith(this.#prefix) || pathname.startsWith('/ws')) {
      return response;
    }
    if (!(req.headers.get('accept') ?? '').includes('text/html')) {
      return response;
    }

    const index = Bun.file(this.#index);
    if (!(await index.exists())) return response;

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

/**
 * Registered only when `CLIENT_DIST` is set, which is the deployed shape: the
 * Docker image builds `apps/fe` and copies its `dist` in beside the server. In
 * development the client is served by Vite on its own port and this module is
 * absent entirely, so nothing here can shadow an API route while you work.
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
