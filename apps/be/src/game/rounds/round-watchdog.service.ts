import { Logger, type OnInit } from '@dunx/core';
import { JobPublisher } from '@dunx/infra/queue';
import { ScheduleKind, ScheduleRegistry } from '@dunx/infra/schedule';
import { AppConfigService } from '../../config/app.config.service.js';
import { EventsPublisher } from '../../notifications/events/events.publisher.js';
import { Topics } from '../../notifications/events/events.js';
import {
  GAME_EVENTS,
  GAME_JOBS,
  GAME_QUEUE,
  publishGame,
} from '../game.events.js';
import { GameRoundStatus } from './game-round.schema.js';
import { GameRoundRepository } from './game-round.repository.js';
import { GameRoundService } from './game-round.service.js';

/**
 * Fails stalled rounds, refunds what was riding on them, and restarts the loop if
 * nothing is alive.
 *
 * A schedule rather than a self-rescheduling job, which dodged a bullmq trap in two
 * directions at once: a bootstrap needs a fixed `jobId` or ten restarts mean ten
 * loops, while a reschedule needs *no* `jobId`, because a just-completed job with
 * that id is still in the completed set and deduplicates the next one. **Do not put
 * it back on the queue.**
 *
 * The **restart** is still enqueued, so a recovered round goes through the same
 * create/bet/launch/crash ordering that is the fairness guarantee.
 *
 * `ScheduleRegistry` rather than `@Interval`, because the interval is validated
 * config and a decorator argument is evaluated before the container exists.
 */
export class GameRoundWatchdog implements OnInit {
  /** Fixed, so `list()`, `trigger()` and `remove()` all name the same one thing. */
  static readonly SCHEDULE = 'game.round.watchdog';

  constructor(
    private readonly rounds: GameRoundService,
    private readonly roundRepo: GameRoundRepository,
    private readonly jobs: JobPublisher,
    private readonly events: EventsPublisher,
    private readonly schedules: ScheduleRegistry,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  onInit(): void {
    const { cleanupIntervalMs } = this.config.get('game');

    this.schedules.add(
      {
        kind: ScheduleKind.INTERVAL,
        at: cleanupIntervalMs,
        name: GameRoundWatchdog.SCHEDULE,
      },
      // The registry never rethrows: a sweep that throws is logged against its entry
      // and the next one still runs. The job path got that from BullMQ's retry.
      () => this.sweep(),
    );
  }

  /** One pass. Public so a test or an operator can run it off its own cadence. */
  async sweep(): Promise<{ failed: number }> {
    const stuck = this.#identifyStuck(
      new Date(Date.now() - this.config.get('game').stuckRoundThresholdMs),
    );
    if (stuck.length === 0) return { failed: 0 };

    let failed = 0;
    let refunded = 0;

    for (const round of stuck) {
      try {
        const { refunds } = this.rounds.failAndRefund(round.id);
        for (const refund of refunds) {
          publishGame(
            this.events,
            Topics.user(refund.userId),
            GAME_EVENTS.WALLET_UPDATED,
            { balanceCents: refund.balanceCents, isDemo: refund.isDemo },
          );
        }
        failed += 1;
        refunded += refunds.length;
        this.logger.debug('failed a stuck round', {
          roundId: round.id,
          status: round.status,
          refunded: refunds.length,
        });
      } catch (error) {
        // Per round, and stays at `error`: one round that cannot be failed is a
        // different problem from a sweep that found a backlog.
        this.logger.error('could not fail a stuck round', {
          roundId: round.id,
          reason: (error as Error).message,
        });
      }
    }

    /**
     * **One line per sweep, not per round.** A backlog is one event, and this used to
     * emit two `warn`s for every round it touched - the second from
     * `failAndRefund` - so a first run against a database that had accumulated
     * fifty of them printed a hundred lines that all said the same thing.
     *
     * The ids are capped. Past a handful the list stops being something anybody
     * reads and `count` is the number that matters.
     */
    this.logger.warn('failed stuck rounds', {
      count: failed,
      refunded,
      roundIds: stuck.slice(0, 5).map((round) => round.id),
      ...(stuck.length > 5 ? { andMore: stuck.length - 5 } : {}),
    });

    // Nothing alive left: the loop died with the rounds it was driving.
    if (this.roundRepo.findCurrentRound() === undefined) {
      await this.jobs.publish(GAME_QUEUE, GAME_JOBS.SCHEDULE, {});
      this.logger.warn('no live round after cleanup, restarted the loop');
    }

    return { failed: stuck.length };
  }

  /**
   * The subtle case is **more than one RUNNING round**. It should be impossible; when
   * it happens the newest is real and the rest are orphans from a process that died
   * mid-transition, which would otherwise hold their players' bets forever.
   */
  #identifyStuck(threshold: Date) {
    const overdue = this.roundRepo.findStuckRounds(threshold);
    const running = this.roundRepo
      .findStuckRounds(new Date())
      .filter((round) => round.status === GameRoundStatus.RUNNING);

    const stuck = new Map(overdue.map((round) => [round.id, round]));

    if (running.length > 1) {
      const newestFirst = [...running].sort(
        (a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0),
      );
      for (const orphan of newestFirst.slice(1)) stuck.set(orphan.id, orphan);
    }

    return [...stuck.values()];
  }
}
