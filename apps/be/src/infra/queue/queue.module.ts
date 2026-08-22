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
 * The queue, publish **and** consume, in one process.
 *
 * `consume` replaced `src/worker.ts` and the `WorkerFactory.attach` branch that came
 * after it: the container starts the workers at `onInit` and stops them at
 * `onShutdown`, which runs before the database and Redis connections the handlers use.
 * An entrypoint cannot express that ordering.
 *
 * `processor` is where the child processes come from. A queue with any handler marked
 * `@JobHandler({ background: true })` is given this **file path** instead of a
 * function and bullmq forks it - that is `notifications` and `media`. The game queue is
 * deliberately not marked: a round transition is latency-critical and the engine
 * reading its result is in this process.
 *
 * The path must be absolute, because bullmq resolves it in the child against the
 * child's cwd. `isolation: 'process'` and not `'thread'`: a fork reads `bunfig.toml`
 * so `@dunx/transform/preload` records constructor types, where a thread enters
 * through bullmq's prebuilt `main-worker.js` and the preload never matches a `.ts`
 * file - the first provider with a constructor parameter then fails at boot.
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
       * One list, and it has to be: the conditional below spreads into this same
       * object, so a second `providers` key there would replace this one rather than
       * add to it - and `QueueDrain` would silently never be constructed.
       *
       * `QueueDrain` is bound so the container builds it, which is what gets its
       * `onBeforeShutdown` called. Nothing injects it.
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
