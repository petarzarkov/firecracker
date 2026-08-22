import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HttpFactory, type HttpApp } from '@dunx/http';
import { OpenApiExplorer, OpenApiModule } from '@dunx/openapi';
import { testRoot } from '@dunx/testing';
import { AppModule } from './app.module.js';
import { AuthDocument } from './auth/auth.document.js';
import { EnvConfig } from './config/env.validation.js';
import { AppHttpOptions } from './http.options.js';
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
let doc: OpenApiDoc;

beforeAll(async () => {
  app = await HttpFactory.create(
    OpenApiModule.forRoot({
      title: 'dunx-template',
      version: '0.1.0',
      root: testRoot([AppModule.forRoot({ source, logLevel: 'fatal' })]),
      contribute: [AuthDocument.for(config)],
    }),
    { ...AppHttpOptions.for(config), requestLogging: false },
  );
  app.setGlobalPrefix('api');
  await app.listen(0);
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
      'Session',
      'UpdateUser',
      'User',
      'ValidationError',
      'Verification',
    ]);
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
   * Locks in a real gap. `RouteSchemas` has no `response` and there is no
   * `@ApiResponse` equivalent, so a success is documented as a bare description
   * with no `content` and the schemas never reach `components` - which means the
   * generated document cannot drive client codegen.
   */
  test('KNOWN GAP: no success response body is documented', () => {
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
   * Deliberately absent: `HealthController` carries `@ApiHidden()`, because a probe is
   * for the orchestrator. Asserted so the omission is not rediscovered as a bug.
   */
  test('the health probes are hidden from the document', () => {
    const paths = Object.keys(doc.paths);
    expect(paths).not.toContain('/api/health/live');
    expect(paths).not.toContain('/api/health/ready');
  });

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
   * `page()` is async: the 456 KB explorer bundle lives behind `@dunx/openapi/ui`
   * and is reached with `await import()`, so importing `@dunx/openapi` does not pull
   * a React app in with it.
   */
  test('the explorer renders a self-contained page', async () => {
    const page = await app.get(OpenApiExplorer).page('api');
    expect(page).toStartWith('<!doctype html>');
    // No external host: a strict CSP or an offline machine must still work.
    expect(page).not.toContain('https://cdn.');
  });
});

// Registered last, so it runs after the server has closed. Isolating the suites
// stopped them writing into the application's namespace; this stops them leaving
// their own behind, since bullmq's `meta` keys carry no TTL.
afterAll(async () => {
  await dropTestNamespaces();
});
