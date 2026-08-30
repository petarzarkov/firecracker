import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HttpFactory, type HttpApp } from '@dunx/http';
import { OpenApiExplorer, OpenApiModule } from '@dunx/openapi';
import { testRoot } from '@dunx/testing';
import { AppModule } from './app.module.js';
import { AuthDocument } from './auth/auth.document.js';
import { EnvConfig } from './config/env.validation.js';
import { dropTestNamespaces, testNamespace } from './test-support/namespace.js';

interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, unknown> };
}

/**
 * `createTestServer` cannot be used here: it owns `HttpFactory.create` and never
 * exposes the app before `listen()`, so there is no window in which to call
 * `setGlobalPrefix`. `testRoot()` is the documented escape hatch.
 */
const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: ':memory:',
  // Off: this graph includes the engine, which enqueues the first round at `onInit`,
  // so a consuming test server would start the clock under the assertions.
  QUEUE_CONSUME: 'false',
  ...testNamespace(),
  THROTTLE_LIMIT: '10000',
};
const config = EnvConfig.validate(source);
let app: HttpApp;
let url: string;
let doc: OpenApiDoc;

beforeAll(async () => {
  app = await HttpFactory.create(
    OpenApiModule.forRoot({
      title: 'dunx-template',
      version: '0.1.0',
      root: testRoot([AppModule.forRoot({ source, logLevel: 'fatal' })]),
      contribute: [AuthDocument.for(config)],
    }),
    { requestLogging: false },
  );
  app.setGlobalPrefix('api');
  url = await app.listen(0);
  doc = JSON.parse(app.get(OpenApiExplorer).json('api')) as OpenApiDoc;
});

afterAll(async () => {
  await app.shutdown();
});

describe('the generated OpenAPI document', () => {
  test('no schema degraded to a permissive one', () => {
    expect(app.get(OpenApiExplorer).warnings).toEqual([]);
  });

  test('is 3.1 and carries the app metadata', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('dunx-template');
  });

  test('every route is documented under the global prefix', () => {
    const paths = Object.keys(doc.paths).sort();
    expect(paths).toContain('/api/users');
    expect(paths).toContain('/api/users/{userId}');
    expect(paths).toContain('/api/users/{userId}/ban');
    expect(paths).toContain('/api/service/config');
    // The game's own surface, which is the point of this app.
    expect(paths).toContain('/api/game/state');
    expect(paths).toContain('/api/game/rounds');
    expect(paths).toContain('/api/game/rounds/{roundId}/verify');
    expect(paths).toContain('/api/wallet');
    for (const path of paths) expect(path).toStartWith('/api/');
  });

  test('named request-body schemas become components', () => {
    // `CreateUser`, `UpdateUser` and `ValidationError` are this app's; `User`,
    // `Session`, `Account` and `Verification` came from Better Auth's own schema
    // through `contribute`, and the merge keeps both without a prefix.
    expect(Object.keys(doc.components.schemas).sort()).toEqual([
      'Account',
      // The avatar routes: what a caller may point `users.image` at, and what
      // comes back. The second is only in the document because the handler
      // returns a `Response`, so nothing else could describe it.
      'AvatarSource',
      'AvatarUpdated',
      'CreateUser',
      // dunx 2.4.0 documents the probes, so the report shape is a component too.
      'HealthReport',
      'Session',
      'UpdateUser',
      'User',
      'ValidationError',
      'Verification',
    ]);
  });

  /**
   * Every hoisted schema's `title` is its own component key, which is what Swagger
   * UI labels a model with. dunx 2.4.0 supplies that default because a `$ref`
   * reached through `items` has no other fallback, so `array<User>` rendered as
   * `array<object>`.
   *
   * A declared `title` wins, which is why none of this app's DTOs declare one: the
   * prose that used to sit there is in `description` now, or the Schemas list reads
   * as sentences instead of type names.
   */
  test('every component is titled with its own name', () => {
    for (const [name, schema] of Object.entries(doc.components.schemas)) {
      expect((schema as { title?: string }).title).toBe(name);
    }
  });

  /**
   * The verification route is the one that most needs documenting: it is the
   * public contract a player checks a round against, and a client written from
   * this document has to know it can 404 before the crash.
   */
  test('the verification route is documented with its path parameter', () => {
    const get = doc.paths['/api/game/rounds/{roundId}/verify']?.['get'];
    expect(get).toBeDefined();
    const params = get?.['parameters'] as { name: string; in: string }[];
    expect(params.map((p) => p.name)).toContain('roundId');
    expect(params.find((p) => p.name === 'roundId')?.in).toBe('path');
  });

  /**
   * **The gap is this app's now, not the framework's.** `RouteSchemas.response`
   * exists - keyed by status, and since 2.4.0 it takes a plain JSON Schema as well
   * as a Standard Schema - so a success body is documentable and none of these
   * routes declare one. Until they do, the document cannot drive client codegen.
   *
   * Kept as an assertion rather than a comment so closing it has to come here and
   * delete this, instead of quietly leaving a stale claim behind.
   */
  test('KNOWN GAP: no route declares a success response body', () => {
    const ok = doc.paths['/api/users']?.['get']?.['responses'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(ok['200']).toEqual({ description: 'OK' });
    expect(ok['200']?.['content']).toBeUndefined();
    expect(Object.keys(doc.components.schemas)).not.toContain('SanitizedUser');
  });

  test('a validating route documents its 400', () => {
    const post = doc.paths['/api/users']?.['post'];
    expect(post).toBeDefined();
    const responses = post?.['responses'] as Record<string, unknown>;
    expect(responses['400']).toBeDefined();
  });

  test('@Roles becomes a security requirement, @Public clears it', () => {
    const listUsers = doc.paths['/api/users']?.['get'];
    expect(listUsers?.['security']).toEqual([{ bearer: [] }]);
    expect(listUsers?.['x-required-roles']).toEqual(['admin', 'user']);

    const build = doc.paths['/api/service/config']?.['get'];
    expect(build?.['security']).toEqual([]);
  });

  /**
   * dunx 2.4.0 reversed this: the probes used to carry `@ApiHidden()` and the old
   * assertion here was that they were absent. They are endpoints someone calls, so
   * they are documented now, and `HealthModule.forRoot({ documented: false })` is
   * the opt-out this app deliberately does not take - the paths are already in the
   * boot banner and the README.
   */
  test.each(['/api/health/live', '/api/health/ready'])(
    '%s is documented, with the report on both outcomes',
    (path) => {
      const probe = doc.paths[path]?.['get'];
      expect(probe?.['tags']).toEqual(['Health']);
      // Public: an orchestrator has no session to present.
      expect(probe?.['security']).toEqual([]);

      const responses = probe?.['responses'] as Record<
        string,
        { content: Record<string, { schema: { $ref: string } }> }
      >;
      // 503 as well as 200, because a probe that only documents the happy path
      // tells a reader nothing about what a failing one returns.
      for (const status of ['200', '503']) {
        expect(
          responses[status]?.content['application/json']?.schema.$ref,
        ).toBe('#/components/schemas/HealthReport');
      }
    },
  );

  /**
   * `tags` is repeated on every method-level `@ApiDoc` on purpose: a method-level
   * one replaces the class-level object wholesale rather than merging, so the class
   * tag is dropped and the operation falls back to the class-name default.
   */
  test('@ApiDoc supplies the summary and the tag', () => {
    const listUsers = doc.paths['/api/users']?.['get'];
    expect(listUsers?.['summary']).toBe('List users, keyset paginated');
    expect(listUsers?.['tags']).toEqual(['users']);
  });

  /**
   * `doc.tags` used to come from controller class names while operations carried
   * their `@ApiDoc` tags, so the document declared tags nothing used. Fixed in
   * @dunx/openapi 0.2.5; this asserts the two agree.
   */
  test('every tag the operations use is declared, and no others', () => {
    const declared = new Set(
      (doc as unknown as { tags: { name: string }[] }).tags.map((t) => t.name),
    );

    const used = new Set<string>();
    for (const methods of Object.values(doc.paths)) {
      for (const op of Object.values(methods)) {
        for (const tag of (op['tags'] as string[] | undefined) ?? []) {
          used.add(tag);
        }
      }
    }

    expect([...used].sort()).toEqual([...declared].sort());
    expect(used.size).toBeGreaterThan(0);
  });

  test('query parameters are expanded one per property', () => {
    const params = doc.paths['/api/users']?.['get']?.['parameters'] as {
      name: string;
      in: string;
    }[];
    const names = params.map((p) => p.name);
    expect(names).toContain('take');
    expect(names).toContain('cursor');
    expect(names).toContain('search');
    expect(params.every((p) => p.in === 'query')).toBe(true);
  });

  /**
   * Better Auth serves `<basePath>/*` from one handler, so route discovery sees one
   * wildcard and the document would describe no authentication surface at all.
   * `contribute` merges the library's own schema; a declared route wins a collision.
   */
  test('Better Auth contributes its own endpoints', () => {
    const paths = Object.keys(doc.paths);
    expect(paths).toContain('/api/auth/sign-in/email');
    expect(paths).toContain('/api/auth/sign-up/email');
    expect(paths).toContain('/api/auth/get-session');
    // The plugins are in the document too: `admin()` and `bearer()` endpoints
    // only exist because they are in `baseAuthOptions`.
    expect(
      paths.filter((p) => p.startsWith('/api/auth/')).length,
    ).toBeGreaterThan(20);
  });

  test('every contributed operation carries the auth tag', () => {
    const operations = Object.entries(doc.paths)
      .filter(([path]) => path.startsWith('/api/auth/') && !path.endsWith('/*'))
      .flatMap(([, methods]) => Object.values(methods));

    expect(operations.length).toBeGreaterThan(0);
    for (const operation of operations) {
      expect(operation['tags']).toEqual(['auth']);
    }
  });

  /**
   * Better Auth's handler is mounted as five wildcard routes, and discovery used to
   * document them like any other - a literal `/api/auth/*`, which is not an OpenAPI
   * path template, duplicating the surface `betterAuthDocument` describes properly.
   */
  test('the mounted auth handler is no longer documented as a wildcard', () => {
    expect(doc.paths['/api/auth/*']).toBeUndefined();
    expect(Object.keys(doc.paths).filter((p) => p.includes('*'))).toEqual([]);
    // And nothing is tagged with the internal class name any more.
    const tags = Object.values(doc.paths)
      .flatMap((methods) => Object.values(methods))
      .flatMap(
        (operation) => (operation['tags'] as string[] | undefined) ?? [],
      );
    expect(tags).not.toContain('MountedAuthHandler');
  });

  /**
   * dunx 2.3.0 replaced its own inlined explorer with Swagger UI, which is an
   * **optional peer**: `@dunx/openapi` resolves `swagger-ui-dist` lazily, on the
   * first request for this page, so a missing install is a broken route rather than
   * a failed boot. `swagger-ui-dist` is therefore a `dependencies` entry here and
   * has to survive the Dockerfile's `--production` install.
   */
  test('the explorer page renders and points at its own origin', async () => {
    const page = await app.get(OpenApiExplorer).page('api');
    expect(page).toStartWith('<!doctype html>');
    expect(page).toContain('/api/docs/swagger-ui-bundle.js');
    // No CDN: a strict CSP or an offline machine must still work.
    expect(page).not.toContain('https://cdn.');
    expect(page).not.toContain('unpkg.com');
  });

  /**
   * The assets actually serve, which is the half `page()` cannot prove: resolution
   * happens per request against the consumer's `node_modules`, so this is what
   * fails if `swagger-ui-dist` is ever dropped from the install.
   */
  test.each([
    ['swagger-ui-bundle.js', 'javascript'],
    ['swagger-ui.css', 'text/css'],
    // Served because `swagger-ui.css` ends with a `sourceMappingURL` pointing at
    // it, so without it every visitor with devtools open logs a 404 against us.
    ['swagger-ui.css.map', 'application/json'],
    ['favicon-32x32.png', 'image/png'],
  ])('%s is served from this app', async (file, type) => {
    const response = await fetch(`${url}api/docs/${file}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(type);
    // `immutable`, made honest by the version in the query string.
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(100);
  });

  /**
   * 2.3.1 serves these from **one wildcard** under `/api/docs`, and the allow-list
   * in `@dunx/openapi` is the only thing between that route and the rest of
   * `swagger-ui-dist` - which also ships four other builds and ~4 MB of sourcemaps.
   */
  test.each([
    'swagger-ui-bundle.js.map',
    'swagger-ui-es-bundle.js',
    'package.json',
    '../../../package.json',
  ])('%s is not served', async (file) => {
    const response = await fetch(`${url}api/docs/${file}`);
    expect(response.status).toBe(404);
  });

  /**
   * `@ApiHidden()`, because a stylesheet in an OpenAPI document is noise - and a
   * literal `*` is not an OpenAPI path template either, so the wildcard would
   * describe nothing if it leaked in.
   */
  test('the explorer assets are absent from the document', () => {
    const paths = Object.keys(doc.paths);
    expect(paths.filter((path) => path.includes('*'))).toEqual([]);
    expect(paths.some((path) => path.startsWith('/api/docs/'))).toBe(false);
  });
});

// Registered last, so it runs after the server has closed. Isolating the suites
// stopped them writing into the application's namespace; this stops them leaving
// their own behind, since bullmq's `meta` keys carry no TTL.
afterAll(async () => {
  await dropTestNamespaces();
});
