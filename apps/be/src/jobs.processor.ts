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
export default new JobProcessor(JobsModule.forRoot(), {
  queues: [QUEUES.NOTIFICATIONS, QUEUES.MEDIA],
}).handle;
