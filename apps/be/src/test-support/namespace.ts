/**
 * The Redis namespaces a suite must not share with anything else.
 *
 * Every spec already took its own `THROTTLE_PREFIX` and none took its own
 * `QUEUE_PREFIX`, so six suites enqueued into the **running application's**
 * queues. `QUEUE_CONSUME: 'false'` stops a suite consuming, not producing: the
 * engine enqueues a round at `onInit`, a sign-up enqueues a welcome email, an
 * upload enqueues a thumbnail. The jobs stayed, and the next `bun run dev`
 * inherited them - 500 failed thumbnails pointing at temp directories the suite
 * had already deleted, and 61 delayed `game-round-start` jobs.
 *
 * `WS_RELAY_CHANNEL` for the same reason: a suite publishing on the shared
 * channel fans its frames out through whatever server is listening on it.
 *
 * One id across all three, so a leftover key says which run left it.
 */
export interface TestNamespace {
  readonly QUEUE_PREFIX: string;
  readonly THROTTLE_PREFIX: string;
  readonly WS_RELAY_CHANNEL: string;
}

/** Every namespace handed out in this process, so a suite can drop its own. */
const handedOut = new Set<string>();

export const testNamespace = (): TestNamespace => {
  const id = `test-${crypto.randomUUID()}`;
  handedOut.add(id);
  return {
    QUEUE_PREFIX: id,
    THROTTLE_PREFIX: id,
    WS_RELAY_CHANNEL: `${id}:ws`,
  };
};

/**
 * Deletes the keys this process's namespaces left behind.
 *
 * Isolating the suites stopped them writing into the application's namespace, but
 * a fresh uuid per run turns shared litter into private litter: bullmq's `meta`
 * and `stalled-check` keys carry no TTL, so every run left about 170 keys in a
 * Redis that outlives it. Called from a suite's `afterAll`.
 *
 * Best effort by design. An absent Redis is the normal case for a unit run, and a
 * suite must not fail because it could not tidy up.
 */
export const dropTestNamespaces = async (url?: string): Promise<void> => {
  if (handedOut.size === 0) return;
  const { Redis } = await import('ioredis');
  const redis = new Redis(
    url ?? Bun.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379',
    {
      maxRetriesPerRequest: 0,
      lazyConnect: true,
      enableOfflineQueue: false,
    },
  );

  try {
    await redis.connect();
    for (const id of handedOut) {
      let cursor = '0';
      do {
        const [next, batch] = await redis.scan(
          cursor,
          'MATCH',
          `${id}*`,
          'COUNT',
          1000,
        );
        cursor = next;
        if (batch.length > 0) await redis.del(...batch);
      } while (cursor !== '0');
    }
    handedOut.clear();
  } catch {
    // No Redis, or it went away mid-teardown. Nothing to tidy and nothing to report.
  } finally {
    redis.disconnect();
  }
};
