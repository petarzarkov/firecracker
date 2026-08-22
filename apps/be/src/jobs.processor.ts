import { JobProcessor } from '@dunx/infra/queue';
import { JobsModule } from './app.module.js';
import { QUEUES } from './notifications/events/events.js';

/**
 * The file bullmq forks into. Nobody runs it directly: `QueuesModule.PROCESSOR`
 * hands the path to bullmq for any queue with a `background` handler, and
 * `JobProcessor` builds {@link JobsModule} once per child and reuses it.
 *
 * A WebP encode is CPU-bound and an SMTP round trip is slow; neither belongs on the
 * loop ticking a multiplier every 100 ms. The `game` queue is not marked, so a round
 * transition stays in-process next to the clock.
 */
export default new JobProcessor(
  /**
   * `API_PORT` has no default, because a serving process that cannot name its port
   * is a misconfiguration - but **a job child binds nothing**, so it would die on
   * the one setting it has no use for. A spec's in-memory `source` cannot cross the
   * fork, so in CI the child died on `expected number, received NaN` and the boot
   * error surfaced only as a delayed job's `failedReason`. `Bun.env` still wins
   * wherever it is set.
   */
  JobsModule.forRoot({
    source: { API_PORT: '0', ...Bun.env },
    // A module option is exactly what cannot cross a fork, so a quiet suite still
    // got a chatty child. `NODE_ENV` does cross, because bullmq forks with the
    // parent's environment and `bun test` sets it. An explicit `LOG_LEVEL` wins.
    ...(Bun.env['NODE_ENV'] === 'test' && Bun.env['LOG_LEVEL'] === undefined
      ? { logLevel: 'fatal' as const }
      : {}),
  }),
  { queues: [QUEUES.NOTIFICATIONS, QUEUES.MEDIA] },
).handle;
