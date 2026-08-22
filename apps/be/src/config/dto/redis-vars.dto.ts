import { z } from 'zod';

/**
 * Redis is optional everywhere it appears: absent, the cache degrades, the throttler
 * stops throttling, the queue answers 503 and the relay fans out locally - and the
 * app still boots. One absent URL is a clearer "there is no Redis" than a
 * host/port/db triple with working defaults.
 */
export const redisVarsSchema = z.object({
  REDIS_URL: z.string().optional(),

  // Deliberately short: a degraded route has to answer, and answering slowly is
  // worse than answering 503.
  REDIS_CONNECT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(50)
    .max(30_000)
    .default(500),

  // Namespaces every counter key: two deployments on one Redis need two values, or
  // one spends the other's budget, and a test run inherits the last run's counters.
  THROTTLE_PREFIX: z.string().default('firecracker'),
  THROTTLE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(20),
  THROTTLE_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),

  /**
   * **On, and there is one process** - isolation is a sandboxed child per handler,
   * so there is no `WORKER_MODE`. `false` is for the integration suites, which build
   * the engine too and would otherwise start the round loop under their assertions.
   * Not a deployment shape.
   */
  QUEUE_CONSUME: z.stringbool().default(true),
  // Namespaces every bullmq key: two deployments on one Redis would each consume the
  // other's jobs, and so would a test run.
  QUEUE_PREFIX: z.string().default('firecracker'),
  QUEUE_MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(3),
  QUEUE_RETRY_DELAY_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(5000),
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(3),
  QUEUE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(100),
  QUEUE_RATE_LIMIT_DURATION_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(1000),
  QUEUE_JOB_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(600_000)
    .default(120_000),

  // The one channel every websocket topic is relayed on. Two deployments sharing a
  // Redis need two values, or each fans out the other's frames.
  WS_RELAY_CHANNEL: z.string().default('firecracker:ws'),
});
