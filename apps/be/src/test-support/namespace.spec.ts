import { afterAll, expect, test } from 'bun:test';
import { Redis } from 'ioredis';
import { dropTestNamespaces, testNamespace } from './namespace.js';

/**
 * The cleanup itself, because it is the thing standing between a suite and 170
 * orphaned keys per run - and a teardown nobody checks is a teardown that quietly
 * stops working.
 */
const REDIS_URL = Bun.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';

afterAll(async () => {
  await dropTestNamespaces(REDIS_URL);
});

test('a namespace is unique per call and carries all three prefixes', () => {
  const a = testNamespace();
  const b = testNamespace();

  expect(a.QUEUE_PREFIX).not.toBe(b.QUEUE_PREFIX);
  expect(a.THROTTLE_PREFIX).toBe(a.QUEUE_PREFIX);
  expect(a.WS_RELAY_CHANNEL).toBe(`${a.QUEUE_PREFIX}:ws`);
  expect(a.QUEUE_PREFIX.startsWith('test-')).toBe(true);
});

test('dropping removes the namespace and leaves everything else alone', async () => {
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 0,
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  try {
    await redis.connect();
  } catch {
    // No Redis here. The unit suites run without one, and this assertion needs it.
    redis.disconnect();
    return;
  }

  const ns = testNamespace();
  const bystander = `not-a-test-namespace-${crypto.randomUUID()}`;
  await redis.set(`${ns.QUEUE_PREFIX}:media:meta`, '1');
  await redis.set(bystander, '1');

  await dropTestNamespaces(REDIS_URL);

  expect(await redis.exists(`${ns.QUEUE_PREFIX}:media:meta`)).toBe(0);
  expect(await redis.exists(bystander)).toBe(1);

  await redis.del(bystander);
  redis.disconnect();
});
