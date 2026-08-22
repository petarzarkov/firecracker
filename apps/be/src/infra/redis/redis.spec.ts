import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { HealthReport } from '@dunx/http';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../../app.module.js';
import { EnvConfig } from '../../config/env.validation.js';
import { AppHttpOptions } from '../../http.options.js';
import { TestSession } from '../../test-support/session.js';
import {
  dropTestNamespaces,
  testNamespace,
} from '../../test-support/namespace.js';

/**
 * The Redis-backed areas, in both states.
 *
 * "Nothing running" is not simulated by not having Redis - that would make the
 * suite depend on the machine. It is a **dead URL**, which is deterministic
 * everywhere and is the harder case anyway: a configured broker that will not
 * answer, rather than one nobody asked for.
 */
const DEAD_REDIS = 'redis://127.0.0.1:1';

const base = (over: Record<string, string>): Record<string, string> => ({
  API_PORT: '0',
  SQLITE_DB_PATH: ':memory:',
  // Off: this suite asserts what degrades without a broker.
  QUEUE_CONSUME: 'false',
  ...testNamespace(),
  SEED_ADMIN_EMAIL: 'admin@local.dev',
  SEED_ADMIN_PASSWORD: 'admin-password',
  ...over,
});

const boot = async (source: Record<string, string>): Promise<TestServer> =>
  createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    ...AppHttpOptions.for(EnvConfig.validate(source)),
    requestLogging: false,
  });

/** Whether the machine running this has a Redis. */
const redisUp = async (): Promise<boolean> => {
  const client = new Bun.RedisClient(undefined, {
    connectionTimeout: 500,
    maxRetries: 0,
  });
  try {
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.close();
  }
};

describe('with a broker that will not answer', () => {
  let server: TestServer;
  let token: string;

  beforeAll(async () => {
    server = await boot(base({ REDIS_URL: DEAD_REDIS, THROTTLE_LIMIT: '1' }));
    // Sessions are in the database by default, so authentication is unaffected by
    // an unreachable Redis. That is the whole reason `AUTH_SESSION_STORE` is an
    // opt-in rather than something `REDIS_URL` switches on.
    token = await TestSession.signIn(
      server,
      'admin@local.dev',
      'admin-password',
    );
  });

  afterAll(async () => {
    await server.close();
  });

  test('the app booted, which is the point', () => {
    expect(token.length).toBeGreaterThan(0);
  });

  /**
   * Redis and the broker are both unreachable, and readiness still answers 200 - both
   * are `critical: false`, because no other replica has a Redis this one does not. The
   * database is the only check that can fail this probe.
   */
  test('readiness stays up with the cache and the broker unreachable', async () => {
    const { status, body } =
      await server.json<HealthReport>('api/health/ready');

    expect(status).toBe(200);
    expect(body.status).toBe('up');
    expect(body.draining).toBe(false);

    const byName = new Map(body.checks.map((check) => [check.name, check]));
    expect(byName.get('database')?.state).toBe('up');
    // Down and non-critical: the pair the old `degraded` bucket meant to express.
    expect(byName.get('redis')?.state).toBe('down');
    expect(byName.get('redis')?.critical).toBe(false);
    expect(byName.get('queue')?.state).toBe('down');
    expect(byName.get('queue')?.critical).toBe(false);
  });

  test('the queue routes answer 503 rather than hanging', async () => {
    const started = Bun.nanoseconds();
    const { status, body } = await server.json<{ message: string }>(
      'api/queues',
      { headers: TestSession.bearer(token) },
    );
    const elapsedMs = (Bun.nanoseconds() - started) / 1e6;

    expect(status).toBe(503);
    expect(body.message).toStartWith('Queue unavailable');
    // A degraded route has to answer, and answering slowly is worse than 503.
    expect(elapsedMs).toBeLessThan(5000);
  });

  /**
   * The rate limiter fails **open**. `THROTTLE_LIMIT` is 1 here, so with a
   * reachable counter the second call would be a 429 - refusing every request
   * because the limiter is down would turn a degraded cache into an outage.
   *
   * This is also what pins `store: new RedisThrottleStore(redis)` in
   * `AppModule.#throttle()`. `ThrottleModule`'s default store is the in-process
   * `MemoryThrottleStore`, which cannot fail and therefore cannot stand aside:
   * leaving it out would 429 the second call here with no Redis in sight.
   */
  test('the throttler stops counting instead of refusing', async () => {
    for (const _ of [1, 2, 3]) {
      const { status } = await server.json('api/profile', {
        headers: TestSession.bearer(token),
      });
      expect(status).toBe(200);
    }
  });
});

describe('with a live broker', () => {
  let server: TestServer | undefined;
  let token = '';
  let live = false;

  beforeAll(async () => {
    live = await redisUp();
    if (!live) return;
    server = await boot(base({ THROTTLE_LIMIT: '2' }));
    token = await TestSession.signIn(
      server,
      'admin@local.dev',
      'admin-password',
    );
  });

  afterAll(async () => {
    await server?.close();
  });

  test('the throttler refuses the third call in the window', async () => {
    if (!live) return;
    const responses: Response[] = [];
    for (const _ of [1, 2, 3]) {
      responses.push(
        await (server as TestServer).request('api/profile', {
          headers: TestSession.bearer(token),
        }),
      );
    }
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 429,
    ]);

    /**
     * The 429 is *thrown*, so it comes out of `ErrorMapper` rather than the
     * guard - and a mapper that only reads `status` and `message` drops the one
     * header a client needs to act on. Asserted here rather than in the unit
     * test alone because the throw crossing the mapper is the part that broke.
     */
    const refused = responses[2] as Response;
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(refused.headers.get('ratelimit-limit')).toBe('2');
    expect(refused.headers.get('ratelimit-remaining')).toBe('0');
    // An allowed call reports the budget too, which is what makes the 429 predictable.
    expect((responses[0] as Response).headers.get('ratelimit-remaining')).toBe(
      '1',
    );
  });

  test('readiness reports the cache up', async () => {
    if (!live) return;
    const { body } = await (server as TestServer).json<HealthReport>(
      'api/health/ready',
    );
    const redis = body.checks.find((check) => check.name === 'redis');
    expect(redis?.state).toBe('up');
  });
});

// Registered last, so it runs after the server has closed. Isolating the suites
// stopped them writing into the application's namespace; this stops them leaving
// their own behind, since bullmq's `meta` keys carry no TTL.
afterAll(async () => {
  await dropTestNamespaces();
});
