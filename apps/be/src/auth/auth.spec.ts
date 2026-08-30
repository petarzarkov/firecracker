import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SyncDatabase } from '@dunx/infra/db';
import { createTestServer, type TestServer } from '@dunx/testing';
import { eq } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { users } from '../users/schema/user.schema.js';
import { wallets } from '../wallet/schema/wallet.schema.js';
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

/**
 * Wiring, not shape - `anon-name.test.ts` covers the shape. What can rot here is
 * the option being dropped from the plugin, which is silent: sign-in still works
 * and every demo player is called `Anonymous` again.
 */
describe('a demo player', () => {
  test('is given a name of their own, not `Anonymous`', async () => {
    const response = await server.request('api/auth/sign-in/anonymous', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    const body = (await response.json()) as { user: { name: string } };
    expect(response.status).toBe(200);
    expect(body.user.name).not.toBe('Anonymous');
    expect(body.user.name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{3}$/);
  });

  /**
   * Converting keeps the run.
   *
   * `anonymous()` deletes the demo user the moment it links a real account, and
   * every table referencing a user cascades - so without `AccountLinker` the bets,
   * the wallet and the uploaded avatar all went with it, at the exact moment the
   * player decided to stay. This is the whole reason `onLinkAccount` is wired.
   */
  test('keeps their wallet and their bets when they make a real account', async () => {
    const anon = await server.request('api/auth/sign-in/anonymous', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const cookie = jar(anon);
    const demoUserId = ((await anon.json()) as { user: { id: string } }).user
      .id;

    // A balance is created the first time anything asks for one.
    const wallet = await server.request('api/wallet?isDemo=true', {
      headers: { cookie },
    });
    expect(wallet.status).toBe(200);

    const db = server.app.get(SyncDatabase);
    const before = db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, demoUserId))
      .all();
    expect(before.length).toBeGreaterThan(0);

    const converted = await server.request('api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        email: 'converted@example.com',
        name: 'Converted',
        password: 'a-strong-password',
      }),
    });
    expect(converted.status).toBe(200);
    const realUserId = ((await converted.json()) as { user: { id: string } })
      .user.id;
    expect(realUserId).not.toBe(demoUserId);

    // The demo row is gone, and the wallet it owned is on the new account rather
    // than gone with it.
    expect(
      db.select().from(users).where(eq(users.id, demoUserId)).all(),
    ).toHaveLength(0);
    const after = db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, realUserId))
      .all();
    expect(after.map((row) => row.id).sort()).toEqual(
      before.map((row) => row.id).sort(),
    );
  });
});
