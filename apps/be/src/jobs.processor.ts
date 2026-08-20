import { JobProcessor } from '@dunx/infra/queue';
import { JobsModule } from './app.module.js';
import { QUEUES } from './notifications/events/events.js';

/**
 * The file bullmq forks into, and all that replaced `src/worker.ts`.
 *
 * Nobody runs this. `QueuesModule.PROCESSOR` hands the path to bullmq for any queue
 * with a `background` handler, and `JobProcessor` builds {@link JobsModule} once per
 * child and reuses it - a fork already costs a process, and a database connection per
 * job on top of that would make the sandbox slower than what it isolates.
 *
 * A WebP encode is CPU-bound and an SMTP round trip is slow; neither belongs on the
 * event loop ticking a multiplier every 100 ms. The `game` queue is not marked, so a
 * round transition stays in-process next to the clock.
 *
 * `queues` is for symmetry: a child that discovered a handler its parent never opened
 * a `Worker` for would simply never receive one, but naming them makes the two fail
 * identically on the same wiring mistake.
 */
export default new JobProcessor(
  /**
   * `API_PORT` is the one variable with no default, because a serving process that
   * cannot name its port is a misconfiguration. **A job child binds nothing**, so it
   * would fail to boot on the one setting it has no use for.
   *
   * That is not hypothetical - it is what CI caught. A spec hands its config to
   * `AppModule.forRoot({ source })` as an in-memory literal, deliberately, rather than
   * mutating the process. A literal cannot cross a fork: bullmq forks this file and
   * the child reads `Bun.env`, so in CI - where there is no `apps/be/.env` for Bun to
   * load - the child died with `API_PORT: expected number, received NaN`, the job sat
   * in `delayed`, and the boot error surfaced as its `failedReason`. It passed locally
   * only because a developer has that file.
   *
   * `Bun.env` still wins wherever it is set, so a deployed child reports the same port
   * as its parent. `0` is simply the honest answer to "which port does this serve on".
   */
  JobsModule.forRoot({
    source: { API_PORT: '0', ...Bun.env },
    // A spec passes `logLevel: 'fatal'` as a module option, and a module option is
    // exactly what cannot cross a fork - so a quiet suite still got a chatty child,
    // and six of them accounted for 31 of the 32 log lines a test run printed.
    // `NODE_ENV` does cross, because bullmq forks with the parent's environment and
    // `bun test` sets it. An explicit `LOG_LEVEL` still wins.
    ...(Bun.env['NODE_ENV'] === 'test' && Bun.env['LOG_LEVEL'] === undefined
      ? { logLevel: 'fatal' as const }
      : {}),
  }),
  { queues: [QUEUES.NOTIFICATIONS, QUEUES.MEDIA] },
).handle;
