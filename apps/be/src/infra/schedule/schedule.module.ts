import type { DynamicModule } from '@dunx/core';
import { ScheduleModule } from '@dunx/infra/schedule';
import { AppConfigService } from '../../config/app.config.service.js';

export interface SchedulesModuleOptions {
  /**
   * Arm what is discovered. `false` in a sandboxed job child, which bullmq forks per
   * burst - an armed schedule there would fire in two or three processes at once.
   */
  readonly enabled?: boolean;
}

/**
 * `@Cron`, `@Interval` and `@OnceOnBoot`, armed at `onInit`.
 *
 * **`global: true`, which is the reason this wrapper exists.**
 * `ScheduleModule.forRootAsync` exports `ScheduleRegistry` but is not global, and two
 * feature modules inject it - `CrashEngineService` for the per-round clock and
 * `GameRoundWatchdog` for the sweep, both on cadences a decorator argument cannot
 * read. Importing the factory in each would be two scopes, two registries and two
 * copies of every schedule. Same shape as `QueuesModule` and `DatabaseModule`.
 *
 * In-process and single-node, which suits an app whose clock already forces one
 * serving process. A schedule that had to fire once across a fleet would be bullmq's
 * own job scheduler.
 */
export class SchedulesModule {
  static forRoot(options: SchedulesModuleOptions = {}): DynamicModule {
    const schedules = ScheduleModule.forRootAsync({
      useFactory: (config: AppConfigService) => ({
        enabled: options.enabled !== false,
        // The app's zone, not the container's `TZ`. Correct on both sides of Bun's
        // 1.4 change, which starts honouring the option instead of ignoring it.
        tz: config.get('app').timezone,
      }),
      inject: [AppConfigService] as const,
    });

    return {
      module: SchedulesModule,
      global: true,
      imports: [schedules],
      // The reference, not a token list, so this does not restate exports that are
      // not its own.
      exports: [schedules],
    };
  }
}
