import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { JobPublisher } from '@dunx/infra/queue';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../../app.module.js';
import { EnvConfig } from '../../config/env.validation.js';
import { AppHttpOptions } from '../../http.options.js';
import { TestSession } from '../../test-support/session.js';
import { JOBS, QUEUES } from '../../notifications/events/events.js';

/**
 * Publish here, consume in a **forked child**.
 *
 * This suite used to spawn `bun src/worker.ts` and wait 2.5 seconds for it. There is no
 * such entrypoint now: `notifications` and `media` are `background`, so bullmq forks
 * `src/jobs.processor.ts` from this very test server - `consume` is on here, unlike
 * every other spec, which is the whole subject. The result is still computed in another
 * process and read back through Redis, and the fork is the mechanism the deployed app
 * uses.
 *
 * Broker assertions are skipped when Redis is unreachable, because `bun test` has to
 * pass on a machine with nothing running; the degraded side is in `redis.spec.ts`.
 *
 * Jobs go through `JobPublisher` rather than the routes, so this asserts the queue
 * rather than an HTTP shape wrapped around it.
 */
const PREFIX = `test-${crypto.randomUUID()}`;
const DB_PATH = `./.tmp/queue-spec-${crypto.randomUUID()}.db`;

let server: TestServer;
let publisher: JobPublisher;
let token = '';
let queueUp = false;

interface JobView {
  state: string;
  result: unknown;
  failedReason: string | null;
}

const source = {
  API_PORT: '0',
  // A file, not `:memory:`: the sandbox child is a separate process with its own
  // container, so in-memory would give it an empty database.
  SQLITE_DB_PATH: DB_PATH,
  // On, and this is the only suite that turns it on.
  QUEUE_CONSUME: 'true',
  // Its own namespace, or this run consumes whatever else is on the same Redis.
  QUEUE_PREFIX: PREFIX,
  THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_LIMIT: '10000',
  SEED_ADMIN_EMAIL: 'admin@local.dev',
  SEED_ADMIN_PASSWORD: 'admin-password',
};

const enqueue = async (name: string, data: unknown): Promise<string> => {
  const job = await publisher.publish(QUEUES.NOTIFICATIONS, name, data);
  return job.id ?? '(unassigned)';
};

const view = async (id: string): Promise<JobView> => {
  const job = await publisher.queue(QUEUES.NOTIFICATIONS).getJob(id);
  if (job === undefined) throw new Error(`no job ${id}`);
  return {
    state: await job.getState(),
    result: (job.returnvalue as unknown) ?? null,
    failedReason: job.failedReason ?? null,
  };
};

/**
 * Waits for the **result**, not merely a terminal state: bullmq reports a state
 * before `returnvalue` is necessarily readable, and a test that stopped at
 * `completed` would flake on exactly the assertion that matters.
 */
const settled = async (id: string): Promise<JobView> => {
  let last: JobView | undefined;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    last = await view(id);
    // `failedReason` rather than `state === 'failed'`: with retries configured a
    // job that has thrown sits in `delayed` between attempts, and only becomes
    // `failed` once every attempt is spent.
    if (last.result !== null || last.failedReason !== null) return last;
    await Bun.sleep(150);
  }
  // The child's stdout is this process's, so whatever it logged is already above.
  throw new Error(
    `job ${id} never produced a result. last=${JSON.stringify(last)}`,
  );
};

beforeAll(async () => {
  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    // The same options production passes, `SessionGuard` included - which is what
    // makes the authorization assertions below meaningful. A suite that omitted
    // them would get a server with no guards that still boots and still answers.
    ...AppHttpOptions.for(EnvConfig.validate(source)),
    requestLogging: false,
  });
  publisher = server.app.get(JobPublisher);
  token = await TestSession.signIn(server, 'admin@local.dev', 'admin-password');

  // One operation decides it: with `maxRetries: 0` and a connection timeout, an
  // enqueue against a down Redis rejects in milliseconds rather than hanging, which
  // is what makes this check cheap enough to do here.
  try {
    await publisher.queue(QUEUES.NOTIFICATIONS).getJobCounts();
    queueUp = true;
  } catch {
    queueUp = false;
  }
});

afterAll(async () => {
  // Stops the bullmq workers before the connections they use, in reverse construction
  // order. The forked children are bullmq's to retire.
  await server.close();
});

describe('the queue routes', () => {
  test('are admin only', async () => {
    const { status } = await server.json('api/queues');
    expect(status).toBe(401);
  });

  test('report counts for every declared queue', async () => {
    if (!queueUp) return;
    const { status, body } = await server.json<{
      broker: string;
      queues: { name: string; counts: Record<string, number> }[];
    }>('api/queues', { headers: TestSession.bearer(token) });

    expect(status).toBe(200);
    expect(body.queues.map((q) => q.name).sort()).toEqual([
      'media',
      'notifications',
    ]);
    expect(body.queues[0]?.counts).toHaveProperty('waiting');
    // The broker URL is redacted, so a password in it never reaches a response.
    expect(body.broker).not.toContain('@');
  });

  test('an unknown queue name is a 400 from the params schema', async () => {
    if (!queueUp) return;
    const { status } = await server.json('api/queues/nope/jobs/1', {
      headers: TestSession.bearer(token),
    });
    expect(status).toBe(400);
  });

  test('an unknown job id is a 404', async () => {
    if (!queueUp) return;
    const { status } = await server.json(
      `api/queues/${QUEUES.NOTIFICATIONS}/jobs/999999`,
      { headers: TestSession.bearer(token) },
    );
    expect(status).toBe(404);
  });

  /**
   * A miss is a **404**, not the session guard's 401.
   *
   * `@dunx/http` defaults to `notFound: 'guarded'`, which gives an unmatched path no
   * route metadata so a global guard refuses it - and `SessionGuard` runs for misses
   * too, since global middleware sits in front of the not-found fallback. That turned
   * every typo into `401 UNAUTHENTICATED`, which says "log in" when the truth is "no
   * such route". `notFound: 'public'` in http.options.ts is what makes this a 404, and
   * this test is what stops that setting being dropped.
   */
  test('an unmatched path is a 404, not the guard\u2019s 401', async () => {
    const { status, body } = await server.json<{ error: string }>('api/queue');
    expect(status).toBe(404);
    expect(body.error).toBe('NOT_FOUND');
  });
});

describe('publish here, consume in a forked child', () => {
  test('a job enqueued by this process is completed in a child', async () => {
    if (!queueUp) return;

    const id = await enqueue(JOBS.USER_REGISTERED, {
      userId: crypto.randomUUID(),
      email: 'queued@example.com',
      name: 'Queued',
    });
    const finished = await settled(id);

    expect(finished.state).toBe('completed');
    // The result was computed in a forked process and read back through Redis,
    // which is the only thing this test is really asserting.
    expect(finished.result).toMatchObject({ notified: expect.any(String) });
  }, 40_000);

  test('a handler that throws is retried and then reported failed', async () => {
    if (!queueUp) return;

    // No handler for this name, so the child's dispatcher rejects it - the same path a
    // throwing handler takes, and it proves the rejection crosses the fork.
    const id = await enqueue('no.such.job', {});
    const finished = await settled(id);

    // Still `delayed` between attempts - the retry policy is three attempts with
    // exponential backoff, which is the point.
    expect(['delayed', 'failed']).toContain(finished.state);
    expect(finished.failedReason).toContain('No handler for');
  }, 40_000);
});

/**
 * **Last in the file, and it has to be**: `drain()` is memoised and irreversible, so
 * nothing after it would consume.
 *
 * The ordering this pins is what a `ctrl-c` exposed. `QueueRunner` stops the workers
 * in `onShutdown`, and `HttpApplication.shutdown()` runs the container's teardown
 * *after* `server.stop()` - so a delayed job coming due in between started against a
 * `PubSub` that no longer had a server, failed, and was retried into a duplicate
 * round. `QueueDrain` moves the stop into `onBeforeShutdown`, which runs while the
 * server is still answering.
 */
describe('draining', () => {
  test('stops consuming while the routes still answer', async () => {
    if (!queueUp) return;

    // Nothing consumes it after the drain, so it is still a real job afterwards -
    // which is the point: it waits for the next boot rather than half-running.
    await server.app.drain();

    const id = await enqueue(JOBS.USER_REGISTERED, {
      userId: crypto.randomUUID(),
      email: 'after-drain@example.com',
      name: 'After Drain',
    });

    // Long enough that a live worker would have taken it - the same job completed in
    // well under a second above.
    await Bun.sleep(2500);
    const after = await view(id);
    expect(['waiting', 'delayed', 'prioritized']).toContain(after.state);
    expect(after.result).toBeNull();

    // And the server is still serving, which is the half that makes the ordering
    // correct rather than merely earlier.
    const { status } = await server.json('api/health/live');
    expect(status).toBe(200);
  }, 20_000);
});
