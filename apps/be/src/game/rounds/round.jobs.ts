import { Logger } from '@dunx/core';
import { JobHandler, JobPublisher } from '@dunx/infra/queue';
import { RedisConnection } from '@dunx/infra/redis';
import type { Job } from 'bullmq';
import { AppConfigService } from '../../config/app.config.service.js';
import { EventsPublisher } from '../../notifications/events/events.publisher.js';
import {
  GAME_EVENTS,
  GAME_JOBS,
  GAME_QUEUE,
  GAME_TOPIC,
  publishGame,
  type RoundJob,
} from '../game.events.js';
import { GameMath } from '../game.math.js';
import {
  GAME_ENGINE_CHANNEL,
  type EngineCommand,
} from '../engine/engine.commands.js';
import { GameRoundService } from './game-round.service.js';
import { ClientSeedService } from '../fairness/client-seed.service.js';
import { AutoCashOutService } from '../betting/auto-cashout.service.js';
import { GameRoundStatus } from './game-round.schema.js';

/**
 * The round lifecycle, as three jobs; the stuck-round sweep is a schedule instead,
 * in `GameRoundWatchdog`.
 *
 * Jobs rather than method calls, for retry: a `crash` that fails mid-settlement must
 * be attempted again or a round's bets are never paid. What makes a retry safe is
 * `GameRoundRepository.transition` putting the expected status in the `WHERE`, so a
 * second run updates no rows.
 *
 * **Not** `background`, unlike notifications and media: a fork would sit between the
 * crash point and the payout.
 */
export class RoundJobs {
  constructor(
    private readonly rounds: GameRoundService,
    private readonly clientSeeds: ClientSeedService,
    private readonly autoCashOut: AutoCashOutService,
    private readonly jobs: JobPublisher,
    private readonly redis: RedisConnection,
    private readonly events: EventsPublisher,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  /**
   * Open a betting window: create the round, tell everyone, and schedule the
   * launch for when the window closes.
   */
  @JobHandler({ queue: GAME_QUEUE, name: GAME_JOBS.SCHEDULE })
  async schedule(): Promise<{ roundId: string }> {
    // Two boots used to mean two rounds. See `GameRoundService.currentRound` for why
    // the guard is on state rather than on a `jobId`.
    const live = this.rounds.currentRound();
    if (live !== undefined) {
      this.logger.debug('a round is already live, not scheduling another', {
        roundId: live.id,
        status: live.status,
      });
      return { roundId: live.id };
    }

    const round = await this.rounds.createNextRound();

    publishGame(this.events, GAME_TOPIC, GAME_EVENTS.PHASE_CHANGE, {
      phase: 'waiting',
      roundId: round.id,
      seedHash: round.seedHash,
      nonce: round.nonce,
      // Spread rather than assigned: the payload declares an *absent* key, and
      // `exactOptionalPropertyTypes` separates that from an explicit `undefined`.
      ...(round.waitingEndsAt === null
        ? {}
        : { waitingEndsAt: round.waitingEndsAt.toISOString() }),
    });

    await this.#command({ action: 'waiting', roundId: round.id });

    await this.jobs.publish(
      GAME_QUEUE,
      GAME_JOBS.START,
      { roundId: round.id } satisfies RoundJob,
      {
        delay: this.config.get('game').waitingPhaseMs,
        jobId: `game-round-start-${round.id}`,
      },
    );

    return { roundId: round.id };
  }

  /**
   * Close the window and launch. The crash point is drawn here, inside
   * `transitionToRunning`, after the client seeds are in and before anyone can bet
   * again - see `GameRoundService` for why that ordering is the fairness property.
   */
  @JobHandler({ queue: GAME_QUEUE, name: GAME_JOBS.START })
  async start(job: Job<RoundJob>): Promise<{ started: boolean }> {
    const { roundId } = job.data;
    const round = await this.rounds.transitionToRunning(roundId);

    // Already started by an earlier attempt of this job. Nothing to broadcast.
    if (round === undefined || round.crashPointX100 === null) {
      return { started: false };
    }

    // Dropped after the draw rather than before, so a retry that lost the
    // transition race still had the seeds available.
    await this.clientSeeds.discard(roundId);

    publishGame(this.events, GAME_TOPIC, GAME_EVENTS.PHASE_CHANGE, {
      phase: 'running',
      roundId: round.id,
      seedHash: round.seedHash,
      nonce: round.nonce,
    });

    await this.#command({
      action: 'start',
      roundId: round.id,
      crashPointX100: round.crashPointX100,
      startedAt: (round.startedAt ?? new Date()).toISOString(),
    });

    return { started: true };
  }

  /**
   * Settle. Every open bet loses, the seed is revealed so the round can be
   * checked, and the next window is scheduled after the cool-down.
   */
  @JobHandler({ queue: GAME_QUEUE, name: GAME_JOBS.CRASH })
  async crash(job: Job<RoundJob>): Promise<{ settled: boolean }> {
    const { roundId } = job.data;
    await this.#honourAutoCashOuts(roundId);
    const round = this.rounds.settleCrash(roundId);

    if (round === undefined || round.crashPointX100 === null) {
      return { settled: false };
    }

    await this.#command({ action: 'crash' });

    publishGame(this.events, GAME_TOPIC, GAME_EVENTS.CRASHED, {
      roundId: round.id,
      crashPoint: GameMath.toMultiplier(round.crashPointX100),
      crashedAt: (round.crashedAt ?? new Date()).toISOString(),
      // The reveal. Everything below is what a player re-runs to check us.
      seed: round.seed,
      clientSeed: round.clientSeed ?? 'firecracker',
      nonce: round.nonce,
      algorithm: round.rngAlgorithm,
    });

    await this.jobs.publish(
      GAME_QUEUE,
      GAME_JOBS.SCHEDULE,
      {},
      {
        delay: this.config.get('game').cooldownMs,
        jobId: `game-round-schedule-after-${roundId}`,
      },
    );

    return { settled: true };
  }

  /**
   * Pay everyone whose target the round actually reached, before the rest is
   * written off.
   *
   * The sweep otherwise only runs on a tick, and the crashing tick deliberately
   * does not sweep - so a target between the last tick and the crash point was
   * never paid. The large version of the same gap is a restart: a process that was
   * down while the round ran produced no ticks at all, so **every** promise made
   * during it settled as a loss even though the curve passed the target.
   *
   * Swept at `crashPoint - 1`, not at the crash point: the engine crashes on
   * `multiplier >= crashPoint` and sweeps only below it, so a hundredth under is
   * the highest multiplier a tick could ever have paid. Paying *at* the crash
   * point would pay a target the running round would have refused.
   *
   * A bet the sweep settles stops being ACTIVE, so `settleAllBetsAsLost` skips it.
   */
  async #honourAutoCashOuts(roundId: string): Promise<void> {
    const round = this.rounds.getById(roundId);
    if (
      round?.status !== GameRoundStatus.RUNNING ||
      round.crashPointX100 === null
    ) {
      return;
    }
    await this.autoCashOut.sweep(roundId, round.crashPointX100 - 1);
  }

  async #command(command: EngineCommand): Promise<void> {
    // Fire and forget past the log: a worker must not fail a job because the web
    // process is not listening. The engine recovers its state from the database
    // at boot anyway, which is what makes a dropped command survivable.
    await this.redis
      .publish(GAME_ENGINE_CHANNEL, JSON.stringify(command))
      .catch((error: unknown) =>
        this.logger.warn('engine command not delivered', {
          action: command.action,
          reason: (error as Error).message,
        }),
      );
  }
}
