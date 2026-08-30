import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { JobPublisher } from '@dunx/infra/queue';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../../app.module.js';
import { TestSession } from '../../test-support/session.js';
import { JOBS, QUEUES } from '../../notifications/events/events.js';

/**
 * Publish here, consume in a **forked child**: `notifications` and `media` are
 * `background`, so bullmq forks `src/jobs.processor.ts` from this test server, and
 * `consume` is on here where every other spec turns it off. Broker assertions skip
 * when Redis is unreachable, since `bun test` must pass with nothing running.
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

const enqueue = async (
  queue: string,
  name: string,
  data: unknown,
): Promise<string> => {
  const job = await publisher.publish(queue, name, data);
  return job.id ?? '(unassigned)';
};

const view = async (queue: string, id: string): Promise<JobView> => {
  const job = await publisher.queue(queue).getJob(id);
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
const settled = async (queue: string, id: string): Promise<JobView> => {
  let last: JobView | undefined;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    last = await view(queue, id);
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
    // The same options production passes, `SessionGuard` included - without them
    // the authorization assertions below would pass against no guards at all.
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
   * A miss is a **404**, not the session guard's 401. dunx defaults to
   * `notFound: 'guarded'`, which turns every typo into `401 UNAUTHENTICATED`;
   * `notFound: 'public'` is what changes it, and this is what keeps it set.
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

    const id = await enqueue(QUEUES.NOTIFICATIONS, JOBS.USER_REGISTERED, {
      userId: crypto.randomUUID(),
      email: 'queued@example.com',
      name: 'Queued',
    });
    const finished = await settled(QUEUES.NOTIFICATIONS, id);

    expect(finished.state).toBe('completed');
    // The result was computed in a forked process and read back through Redis,
    // which is the only thing this test is really asserting.
    expect(finished.result).toMatchObject({ notified: expect.any(String) });
  }, 40_000);

  test('a handler that throws is retried and then reported failed', async () => {
    if (!queueUp) return;

    // No handler for this name, so the child's dispatcher rejects it - the same path a
    // throwing handler takes, and it proves the rejection crosses the fork.
    const id = await enqueue(QUEUES.NOTIFICATIONS, 'no.such.job', {});
    const finished = await settled(QUEUES.NOTIFICATIONS, id);

    // Still `delayed` between attempts - the retry policy is three attempts with
    // exponential backoff, which is the point.
    expect(['delayed', 'failed']).toContain(finished.state);
    expect(finished.failedReason).toContain('No handler for');
  }, 40_000);
});

/**
 * The other sandboxed queue. The source key is deliberately one that is not there:
 * a spec's config is an in-memory literal and **a literal cannot cross a fork**, so
 * the child resolves a different `STORAGE_LOCAL_ROOT` and no temp directory can be
 * shared without mutating the environment. The missing key still proves the part in
 * doubt - the frame reached `MediaJobs` in another process and came back through
 * Redis in that handler's own words.
 */
describe('the media queue, forked for the same reason', () => {
  test('a thumbnail job is dispatched to MediaJobs in a child', async () => {
    if (!queueUp) return;

    const id = await enqueue(QUEUES.MEDIA, JOBS.FILE_THUMBNAIL, {
      fileId: crypto.randomUUID(),
      key: 'users/nobody/avatars/gone.png',
      width: 64,
    });
    const finished = await settled(QUEUES.MEDIA, id);

    // `MediaJobs`'s own message, from `MediaJobs.#read`.
    expect(finished.failedReason).toContain('thumbnail source missing');
    // And `failed` rather than `delayed`: a source that is not there can never
    // appear, so the handler raises `UnrecoverableError` and spends no retries.
    expect(finished.state).toBe('failed');
  }, 40_000);
});

/**
 * **Last in the file, and it has to be**: `drain()` is memoised and irreversible, so
 * nothing after it would consume. What it pins is that `QueueDrain` stops the
 * workers in `onBeforeShutdown` - while the server still answers - rather than in
 * `onShutdown`, which runs after `server.stop()` and left a delayed job failing into
 * a duplicate round.
 */
describe('draining', () => {
  test('stops consuming while the routes still answer', async () => {
    if (!queueUp) return;

    // Nothing consumes it after the drain, so it is still a real job afterwards -
    // which is the point: it waits for the next boot rather than half-running.
    await server.app.drain();

    const id = await enqueue(QUEUES.NOTIFICATIONS, JOBS.USER_REGISTERED, {
      userId: crypto.randomUUID(),
      email: 'after-drain@example.com',
      name: 'After Drain',
    });

    // Long enough that a live worker would have taken it - the same job completed in
    // well under a second above.
    await Bun.sleep(2500);
    const after = await view(QUEUES.NOTIFICATIONS, id);
    expect(['waiting', 'delayed', 'prioritized']).toContain(after.state);
    expect(after.result).toBeNull();

    // And the server is still serving, which is the half that makes the ordering
    // correct rather than merely earlier.
    const { status } = await server.json('api/health/live');
    expect(status).toBe(200);
  }, 20_000);
});
