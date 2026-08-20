import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../app.module.js';
import { EnvConfig } from '../config/env.validation.js';
import { AppHttpOptions } from '../http.options.js';

/**
 * The SPA rewrite, against a real server and a real dist directory.
 *
 * These assertions all failed before `SpaFallback` learned that `@dunx/http`
 * reports an unmatched path by throwing rather than by answering 404.
 */
let server: TestServer;
let root: string;

const INDEX = '<!doctype html><title>firecracker</title>';
const ASSET = 'console.log(1)';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'firecracker-client-'));
  await writeFile(join(root, 'index.html'), INDEX);
  await writeFile(join(root, 'index-Aue2z3V_.js'), ASSET);

  const source = {
    API_PORT: '0',
    SQLITE_DB_PATH: ':memory:',
    // Off: this graph includes the engine, which enqueues the first round at
    // `onInit`, so a consuming test server would start the clock under the assertions.
    QUEUE_CONSUME: 'false',
    THROTTLE_LIMIT: '10000',
    THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
    CLIENT_DIST: root,
  };

  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    ...AppHttpOptions.for(EnvConfig.validate(source)),
    requestLogging: false,
  });
});

afterAll(async () => {
  await server?.close();
  await rm(root, { recursive: true, force: true });
});

const html = { accept: 'text/html,application/xhtml+xml' };

describe('SpaFallback', () => {
  test('a deep link that wants HTML gets the app', async () => {
    const response = await server.request('lobby/table/7', { headers: html });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toBe(INDEX);
  });

  test('the root gets the app', async () => {
    // `StaticFiles` falls through on a directory request, so `/` reaches the miss
    // like any other unmatched path.
    const response = await server.request('', { headers: html });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX);
  });

  test('a hashed asset is served as itself, not rewritten', async () => {
    const response = await server.request('index-Aue2z3V_.js', {
      headers: html,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(ASSET);
  });

  test('an unmatched API path stays a JSON 404', async () => {
    const response = await server.request('api/nope', { headers: html });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  test('a caller that did not ask for HTML gets its 404', async () => {
    const response = await server.request('lobby/table/7', {
      headers: { accept: 'application/json' },
    });
    expect(response.status).toBe(404);
  });

  test('a non-GET miss is not answered with a page', async () => {
    const response = await server.request('lobby/table/7', {
      method: 'POST',
      headers: html,
    });
    expect(response.status).not.toBe(200);
  });
});
