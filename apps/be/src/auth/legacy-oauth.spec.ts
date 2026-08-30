import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../app.module.js';
import { EnvConfig } from '../config/env.validation.js';
import { AuthOptions } from './auth.options.js';
import {
  dropTestNamespaces,
  testNamespace,
} from '../test-support/namespace.js';

/**
 * The callback URL the OAuth apps at GitHub and LinkedIn are registered with is the
 * one Passport composed - `/api/auth/<provider>/callback` - and better-auth serves
 * `/api/auth/callback/<provider>`. GitHub answers "the redirect_uri is not
 * associated with this application" to the difference.
 *
 * The risk worth a spec is not the rewrite, it is the **reach**: better-auth is
 * mounted as `/api/auth/*`, so this route only exists if a parameterised segment
 * out-ranks a wildcard in the route table. Before it was added, every path here
 * answered 404 from better-auth's own dispatcher.
 */
const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: ':memory:',
  QUEUE_CONSUME: 'false',
  THROTTLE_LIMIT: '10000',
  GITHUB_OAUTH_CLIENT_ID: 'gh-id',
  GITHUB_OAUTH_CLIENT_SECRET: 'gh-secret',
  ...testNamespace(),
};

let server: TestServer;

beforeAll(async () => {
  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    requestLogging: false,
  });
});

afterAll(async () => {
  await server?.close();
  await dropTestNamespaces();
});

describe('the callback URL the NestJS version registered', () => {
  /**
   * `state_mismatch` is the *success* condition here. It is better-auth's own answer
   * to a callback whose state cookie it cannot match, which means the request
   * reached the OAuth callback route rather than the wildcard's 404 - and a real
   * browser arrives carrying the cookie this test has no way to forge.
   */
  test.each(['github', 'linkedin', 'google'])(
    'reaches better-auth for %s',
    async (provider) => {
      const response = await server.request(
        `api/auth/${provider}/callback?code=x&state=y`,
        { redirect: 'manual' },
      );

      expect(response.status).not.toBe(404);
      expect(response.headers.get('location')).toContain('state_mismatch');
    },
  );

  /**
   * The `:provider` segment is handed to better-auth's dispatcher, so it is an
   * allow-list rather than a passthrough - otherwise a caller picks which
   * better-auth route runs by naming it here.
   */
  test('refuses a provider it does not know', async () => {
    const response = await server.request(
      'api/auth/not-a-provider/callback?code=x&state=y',
      { redirect: 'manual' },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('location')).toBeNull();
  });

  /** The canonical path keeps working - this adds a door, it does not move one. */
  test('leaves better-auth own callback path alone', async () => {
    const response = await server.request(
      'api/auth/callback/github?code=x&state=y',
      { redirect: 'manual' },
    );

    expect(response.headers.get('location')).toContain('state_mismatch');
  });

  /** What the provider is told, and what it compares against its registration. */
  test('is the URL the providers are pinned to', () => {
    const config = EnvConfig.validate(source);

    expect(AuthOptions.legacyCallback(config, 'github')).toBe(
      `${config.auth.baseUrl}/api/auth/github/callback`,
    );
  });
});
