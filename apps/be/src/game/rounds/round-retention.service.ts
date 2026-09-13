import { Logger, type OnInit } from '@dunx/core';
import { ScheduleKind, ScheduleRegistry } from '@dunx/infra/schedule';
import { AppConfigService } from '../../config/app.config.service.js';
import { GameRoundRepository } from './game-round.repository.js';

/**
 * Keeps the round table to the newest `GAME_ROUND_RETENTION` rows.
 *
 * A round every fifteen seconds is about 5,700 a day, and nothing ever read them
 * past the crash strip. Left alone the table had reached 72,154 rows.
 *
 * **This is a demo's policy, not a crash game's.** The seed and its hash are what
 * a player checks a past result against, so deleting a round makes that round
 * unverifiable by anyone, forever. A deployment that means its fairness promise
 * keeps every round and moves old ones out of the hot table instead.
 *
 * `ScheduleRegistry` rather than `@Interval`, for the reason `GameRoundWatchdog`
 * uses it: the interval is validated config, and a decorator argument is
 * evaluated before the container exists.
 */
export class GameRoundRetention implements OnInit {
  /** Fixed, so `list()`, `trigger()` and `remove()` all name the same one thing. */
  static readonly SCHEDULE = 'game.round.retention';

  constructor(
    private readonly rounds: GameRoundRepository,
    private readonly schedules: ScheduleRegistry,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  onInit(): void {
    const { roundRetentionIntervalMs } = this.config.get('game');

    this.schedules.add(
      {
        kind: ScheduleKind.INTERVAL,
        at: roundRetentionIntervalMs,
        name: GameRoundRetention.SCHEDULE,
      },
      // The registry logs a throwing pass against its entry and runs the next one,
      // which is the behaviour wanted here: a failed prune is not worth a restart.
      () => {
        this.prune();
      },
    );
  }

  /**
   * One pass. Public so a test or an operator can run it off its own cadence.
   *
   * Synchronous because the whole database layer is: drizzle over `bun:sqlite` in
   * synchronous mode. One `DELETE` under an index, not a row-at-a-time loop.
   */
  prune(): { deleted: number } {
    const keep = this.config.get('game').roundRetention;
    const deleted = this.rounds.pruneToNewest(keep);

    // Silent when it deleted nothing, which is most passes once the table has
    // been trimmed once. A prune that found nothing is not an event.
    if (deleted > 0) {
      this.logger.info('pruned old rounds', { deleted, kept: keep });
    }

    return { deleted };
  }
}
