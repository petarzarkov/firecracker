import { AppRef, Logger, type OnBeforeShutdown } from '@dunx/core';
import { QueueRunner } from '@dunx/infra/queue';

/**
 * Stops consuming while the server is **still up**.
 *
 * `QueueRunner` stops workers in `onShutdown`, which runs after `server.stop()` - so
 * a delayed job coming due in that window starts against a `PubSub` with no server.
 * Draining here closes it: `stop()` waits out what is mid-flight, and everything it
 * waits for can still publish. The second `stop()` during teardown is a no-op, and
 * drain hooks run concurrently, so this overlaps `HEALTH_DRAIN_DELAY_MS`.
 */
export class QueueDrain implements OnBeforeShutdown {
  constructor(
    /**
     * `AppRef`, not `QueueRunner`: `QueueModule` binds the runner without exporting
     * it, so a constructor parameter here is a boot error. `app.get` resolves
     * through the root, where a `global: true` module's bindings are reachable.
     */
    private readonly ref: AppRef,
    private readonly logger: Logger,
  ) {}

  async onBeforeShutdown(): Promise<void> {
    let consumer;
    try {
      // Absent when `QUEUE_CONSUME` is off, and in a sandbox child - nothing to stop.
      consumer = this.ref.current.get(QueueRunner).consumer;
    } catch (error) {
      // Never throw out of a drain hook: `App.drain()` runs them under one
      // `Promise.all`, so a rejection fails the whole shutdown.
      this.logger.warn('could not reach the queue runner to drain it', {
        reason: (error as Error).message,
      });
      return;
    }
    if (consumer === undefined) return;

    this.logger.debug('draining queue workers while the server still answers');
    await consumer.stop();
  }
}
