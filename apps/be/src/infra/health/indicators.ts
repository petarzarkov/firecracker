import { HealthIndicator, RedisIndicator, type ProbeResult } from '@dunx/http';
import { JobPublisher, QueueOptions } from '@dunx/infra/queue';
import { QUEUES } from '../../notifications/events/events.js';

/**
 * Redis, reported but **never gating readiness**.
 *
 * `RedisIndicator` is critical by default, which is right for an app whose sessions
 * live there. Not here: this app's invariant is that an absent Redis degrades a route
 * and never the process. It would not help either - readiness sheds traffic so another
 * replica can take it, and no other replica has a Redis this one does not.
 */
export class OptionalRedisIndicator extends RedisIndicator {
  override readonly critical = false;
}

/**
 * Whether the broker answers, and how much is waiting on it.
 *
 * `critical: false` for the same reason, with a sharper edge: no broker means the round
 * loop does not advance, which is a dead game - and still not a reason to shed traffic
 * from a process that is serving history, wallets, auth and the client.
 *
 * The counts come with it because "up" is not the question during an incident: a
 * reachable broker with `waiting` climbing is a stalled consumer, and that reads
 * identically to a healthy queue on a probe that only pings.
 */
export class QueueIndicator extends HealthIndicator {
  readonly name = 'queue';
  override readonly critical = false;

  constructor(
    private readonly publisher: JobPublisher,
    private readonly options: QueueOptions,
  ) {
    super();
  }

  async check(): Promise<ProbeResult> {
    // One queue, not all three. Reachability is a property of the broker rather than
    // of a key prefix, and this path is scraped every two seconds.
    const counts = await this.publisher
      .queue(QUEUES.NOTIFICATIONS)
      .getJobCounts();

    return {
      state: 'up',
      detail:
        `${this.options.redactedUrl} ` +
        `waiting=${counts['waiting'] ?? 0} ` +
        `active=${counts['active'] ?? 0} ` +
        `failed=${counts['failed'] ?? 0}`,
    };
  }
}
