import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { AppFactory, type App } from '@dunx/core';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule, JobsModule } from './app.module.js';
import { EnvConfig } from './config/env.validation.js';
import { AppHttpOptions } from './http.options.js';

/**
 * The module graph, asserted rather than read.
 *
 * dunx 2.2.0 warns when one module class is registered more than once and the
 * registrations bind the same token: a configured module is keyed on the object
 * `forRoot()` returned and it returns a new one per call, so two of them are two
 * scopes holding two instances. That is the trap seven comments in this repo were
 * written about, and it is now detectable.
 *
 * It is detectable and **invisible**: the graph logs its warnings through `Logger`
 * at `warn`, and every spec here boots at `fatal` so a suite would never print one.
 * `app.warnings` is the only place the answer survives, which is why this asserts on
 * it instead of trusting a reader to have looked.
 *
 * Both graphs, because they are different: `AppModule` serves and holds the clock,
 * `JobsModule` is what bullmq forks, and only the second is built by a process that
 * nobody watches.
 */
const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: ':memory:',
  // Off: this graph includes the engine, which enqueues the first round at `onInit`,
  // so a consuming test server would start the clock under the assertions.
  QUEUE_CONSUME: 'false',
  THROTTLE_LIMIT: '10000',
  THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
};

let server: TestServer;

beforeAll(async () => {
  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    ...AppHttpOptions.for(EnvConfig.validate(source)),
    requestLogging: false,
  });
});

afterAll(async () => {
  await server.close();
});

describe('the module graph', () => {
  test('the serving graph registers nothing twice', () => {
    expect(server.app.warnings).toEqual([]);
  });

  test('the sandboxed job graph registers nothing twice', async () => {
    const app: App = await AppFactory.create(
      JobsModule.forRoot({ source, logLevel: 'fatal' }),
    );
    try {
      expect(app.warnings).toEqual([]);
    } finally {
      await app.shutdown();
    }
  });
});
