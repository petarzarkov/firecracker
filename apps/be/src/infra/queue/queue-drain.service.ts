import { AppRef, Logger, type OnBeforeShutdown } from '@dunx/core';
import { QueueRunner } from '@dunx/infra/queue';

/**
 * Stops consuming while the server is **still up**.
 *
 * `QueueRunner` stops the workers in `onShutdown`, and `HttpApplication.shutdown()`
 * runs the container's teardown *after* `server.stop()`. Between those two the
 * workers are still live, so a delayed job coming due in that window starts against
 * a `PubSub` that no longer has a server - which is not theoretical:
 *
 * ```
 * ^C
 * socket closed (1006)                     ← server.stop()
 * Stopping queue workers before teardown   ← QueueRunner.onShutdown
 * game round created                       ← a job started anyway
 * Job failed game.round.schedule: PubSub has no server yet
 * ```
 *
 * `onBeforeShutdown` is the phase for exactly this - "stop taking new work while
 * still serving" - so stopping here closes the window: `stop()` waits out whatever is
 * mid-flight, and everything it waits for still has a server to publish through.
 *
 * `QueueRunner.onShutdown` calls `stop()` again during teardown. `QueueConsumer.stop`
 * memoises on `#stopping`, so the second call returns the same promise.
 *
 * The drain phase runs every hook concurrently, so this overlaps
 * `HEALTH_DRAIN_DELAY_MS` rather than adding to it.
 */
export class QueueDrain implements OnBeforeShutdown {
  constructor(
    /**
     * `AppRef`, not `QueueRunner`, and the difference is scope. `QueueModule` binds
     * the runner but does not export it, so a constructor parameter here is a boot
     * error - the container resolves an injection site through the declaring module's
     * visible set. `app.get` goes through the root, where a `global: true` module's
     * bindings are reachable. Same late-resolution trick `QueueRunner` uses for the
     * handlers it cannot name up front.
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
      // `Promise.all`, so a rejection here would fail the whole shutdown over a
      // consumer that may not even exist.
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
