import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SyncDatabase } from '@dunx/infra/db';
import { createTestServer, type TestServer } from '@dunx/testing';
import { eq } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { EnvConfig } from '../config/env.validation.js';
import { AppHttpOptions } from '../http.options.js';
import { users } from '../users/schema/user.schema.js';
import {
  dropTestNamespaces,
  testNamespace,
} from '../test-support/namespace.js';

/**
 * A session may not outlive the user it names.
 *
 * better-auth's cookie cache signs the session *and the user* into the cookie, so
 * `getSession` answers from it without reading the database. With it on, deleting
 * the user row left `/get-session` returning 200 and the full user for another five
 * minutes - and the socket's first frame then died on `FOREIGN KEY constraint
 * failed` inside `WalletRepository.getOrCreate`, because a wallet cannot reference a
 * user that is not there.
 *
 * The deletion is not hypothetical: `anonymous()` removes the demo account when a
 * player converts it to a real one, which is the app's most travelled path.
 */
const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: ':memory:',
  QUEUE_CONSUME: 'false',
  THROTTLE_LIMIT: '10000',
  ...testNamespace(),
};

let server: TestServer;

const jar = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

const signUp = async (email: string) => {
  const response = await server.request('api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      name: 'ghost',
      password: 'a-strong-password',
    }),
  });
  return jar(response);
};

const session = async (cookie: string) => {
  const response = await server.request('api/auth/get-session', {
    headers: { cookie },
  });
  const text = await response.text();
  return {
    status: response.status,
    body:
      text === ''
        ? null
        : (JSON.parse(text) as { user?: { id: string } } | null),
  };
};

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
  await dropTestNamespaces();
});

describe('a session whose user is gone', () => {
  test('resolves to nothing, rather than to a user the database lacks', async () => {
    const cookie = await signUp('ghost@local.dev');

    const before = await session(cookie);
    const userId = before.body?.user?.id;
    expect(userId).toBeDefined();

    // Out from under the live session, the way `anonymous()` does on conversion.
    const db = server.app.get(SyncDatabase);
    db.delete(users)
      .where(eq(users.id, userId as string))
      .run();

    const after = await session(cookie);
    expect(after.body?.user).toBeUndefined();
  });

  /**
   * Sign-out has to reach the server. The client clearing its own store left the
   * cookie alive, so the next `/get-session` signed the user straight back in - which
   * is exactly what "log out and I am instantly logged in" was.
   */
  test('sign-out ends it on the server, not just in the client', async () => {
    const cookie = await signUp('leaver@local.dev');
    expect((await session(cookie)).body?.user).toBeDefined();

    await server.request('api/auth/sign-out', {
      method: 'POST',
      headers: { cookie },
    });

    expect((await session(cookie)).body?.user).toBeUndefined();
  });
});
