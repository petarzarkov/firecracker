import type { DynamicModule } from '@dunx/core';
import { QueueModule } from '@dunx/infra/queue';
import { AppConfigService } from '../../config/app.config.service.js';
import { QueueDrain } from './queue-drain.service.js';
import { QueueUnavailableMiddleware } from './queue-unavailable.middleware.js';
import { QueuesController } from './queues.controller.js';

export interface QueueModuleOptions {
  /** `false` in a sandboxed job child, which serves no HTTP. */
  readonly controllers?: boolean;
}

/**
 * The queue, publish **and** consume, in one process. `consume` here rather than an
 * entrypoint, because only the container can start the workers at `onInit` and stop
 * them at `onShutdown` - before the connections their handlers use.
 *
 * `processor` is where the child processes come from: a queue with any
 * `background: true` handler is given this **file path** and bullmq forks it.
 *
 * `isolation: 'process'`, never `'thread'`. A fork reads `bunfig.toml`, so
 * `@dunx/transform/preload` runs; a thread enters through bullmq's prebuilt
 * `main-worker.js` where the preload never matches a `.ts` file, and the first
 * provider with a constructor parameter fails at boot.
 */
export class QueuesModule {
  /** Absolute, and computed rather than written out, so moving the file cannot lie. */
  static readonly PROCESSOR = new URL(
    '../../jobs.processor.ts',
    import.meta.url,
  ).pathname;

  static forRoot(options: QueueModuleOptions = {}): DynamicModule {
    const queues = QueueModule.forRootAsync({
      useFactory: (config: AppConfigService) => {
        const { url, connectTimeoutMs } = config.get('redis');
        const queue = config.get('queue');
        return {
          ...(url === undefined ? {} : { url }),
          prefix: queue.prefix,
          // `maxRetries: 0` is what makes an enqueue against a down Redis answer in
          // milliseconds instead of hanging, and what lets the process exit.
          connection: {
            connectionTimeout: connectTimeoutMs,
            maxRetries: 0,
          },
          defaultJobOptions: {
            attempts: queue.maxRetries,
            backoff: { type: 'exponential', delay: queue.retryDelayMs },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 500 },
          },
          worker: {
            concurrency: queue.concurrency,
            limiter: {
              max: queue.rateLimitMax,
              duration: queue.rateLimitDurationMs,
            },
          },
          // Not a bullmq feature: `lockDuration` answers "did the worker die", not
          // "is this handler stuck".
          jobTimeoutMs: queue.jobTimeoutMs,
          // `QueueRunner` turns this off by itself in a sandbox child - it checks
          // `DUNX_JOB_WORKER` - and a broker that is down degrades rather than
          // failing the boot.
          consume: queue.consume,
          processor: QueuesModule.PROCESSOR,
          isolation: 'process' as const,
        };
      },
      inject: [AppConfigService] as const,
    });

    return {
      module: QueuesModule,
      global: true,
      imports: [queues],
      // Every feature that enqueues reads `JobPublisher`, which is what global is for.
      exports: [queues],
      /**
       * One list, and it has to be: the conditional below spreads into this object,
       * so a second `providers` key there would replace this one and `QueueDrain`
       * would silently never be constructed - it is bound only so the container
       * builds it and calls `onBeforeShutdown`.
       */
      providers: [
        QueueDrain,
        ...(options.controllers === false ? [] : [QueueUnavailableMiddleware]),
      ],
      ...(options.controllers === false
        ? {}
        : {
            controllers: [QueuesController],
            // Module-scoped, covering exactly the routes `QueuesController` declares -
            // the one thing `HttpOptions.middleware` cannot express.
            middleware: [QueueUnavailableMiddleware],
          }),
    };
  }
}
