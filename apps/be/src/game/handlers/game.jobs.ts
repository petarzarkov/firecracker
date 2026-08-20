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
} from '../engine/crash-engine.service.js';
import { GameRoundService } from '../services/game-round.service.js';

/**
 * The round lifecycle, as three jobs. The fourth was `cleanup`; it is a schedule now,
 * in `GameRoundWatchdog`.
 *
 * Jobs rather than method calls even with one process consuming, and the reason is
 * retry: a `crash` that fails mid-settlement must be attempted again or a round's bets
 * are never paid. The idempotency that makes a retry safe is not a `try`/`catch` - it
 * is `GameRoundRepository.transition`, which puts the expected current status in the
 * `WHERE`, so a second run updates no rows.
 *
 * This queue is **not** `background`, unlike notifications and media: a transition is
 * latency-critical and the engine reading its result is in this process, so a fork
 * would sit between the crash point and the payout.
 *
 * An {@link EngineCommand} on a Redis channel is still how the clock is told what a
 * round became - a loopback publish now, kept because it is also the recovery path.
 */
export class GameJobs {
  constructor(
    private readonly rounds: GameRoundService,
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

    // The seeds are spent. Dropped after the draw rather than before, so a retry
    // that lost the transition race still had them available.
    await this.redis
      .del(GameRoundService.clientSeedsKey(roundId))
      .catch(() => 0);

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
