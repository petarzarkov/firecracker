import { Logger } from '@dunx/core';
import { JobHandler, JobPublisher } from '@dunx/infra/queue';
import { RedisConnection } from '@dunx/infra/redis';
import type { Job } from 'bullmq';
import { AppConfigService } from '../../config/app.config.service.js';
import { EventsPublisher } from '../../notifications/events/events.publisher.js';
import { userTopic } from '../../notifications/events/events.js';
import {
  GAME_EVENTS,
  GAME_JOBS,
  GAME_QUEUE,
  GAME_TOPIC,
  publishGame,
  type RoundJob,
} from '../game.events.js';
import { toMultiplier } from '../game.math.js';
import {
  GAME_ENGINE_CHANNEL,
  type EngineCommand,
} from '../engine/crash-engine.service.js';
import { GameRoundStatus } from '../schema/game-round.schema.js';
import { GameRoundRepository } from '../repos/game-round.repository.js';
import {
  clientSeedsKey,
  GameRoundService,
} from '../services/game-round.service.js';

/**
 * The round lifecycle, as four jobs.
 *
 * These run in the **worker**, which is what makes the split work: the worker owns
 * every database transition and the web process owns the clock, and the only thing
 * that crosses between them is an {@link EngineCommand} on a Redis channel.
 *
 * Every handler is idempotent, because BullMQ will retry one. The idempotency is
 * not a `try`/`catch` - it is `GameRoundRepository.transition`, which puts the
 * expected current status in the `WHERE` so a second run updates no rows and the
 * handler returns having done nothing.
 */
export class GameJobs {
  constructor(
    private readonly rounds: GameRoundService,
    private readonly roundRepo: GameRoundRepository,
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
    await this.redis.del(clientSeedsKey(roundId)).catch(() => 0);

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
      crashPoint: toMultiplier(round.crashPointX100),
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
   * The watchdog. Fails rounds that stalled, refunds what was riding on them, and
   * restarts the loop if it finds nothing alive.
   *
   * It reschedules itself with **no `jobId`**, and that is not an oversight: a
   * fixed id is deduplicated by BullMQ while the just-completed job with that id
   * is still in the completed set, so the loop would run exactly once and stop.
   */
  @JobHandler({ queue: GAME_QUEUE, name: GAME_JOBS.CLEANUP })
  async cleanup(): Promise<{ failed: number }> {
    const { stuckRoundThresholdMs, cleanupIntervalMs } =
      this.config.get('game');
    const threshold = new Date(Date.now() - stuckRoundThresholdMs);
    const stuck = this.#identifyStuck(threshold);

    for (const round of stuck) {
      try {
        const { refunds } = this.rounds.failAndRefund(round.id);
        for (const refund of refunds) {
          publishGame(
            this.events,
            userTopic(refund.userId),
            GAME_EVENTS.WALLET_UPDATED,
            { balanceCents: refund.balanceCents, isDemo: refund.isDemo },
          );
        }
        this.logger.warn('failed a stuck round', {
          roundId: round.id,
          status: round.status,
          refunded: refunds.length,
        });
      } catch (error) {
        this.logger.error('could not fail a stuck round', {
          roundId: round.id,
          reason: (error as Error).message,
        });
      }
    }

    // Nothing alive left: the loop died with the rounds it was driving.
    if (stuck.length > 0 && this.roundRepo.findCurrentRound() === undefined) {
      await this.jobs.publish(GAME_QUEUE, GAME_JOBS.SCHEDULE, {});
      this.logger.warn('no live round after cleanup, restarted the loop');
    }

    await this.jobs.publish(
      GAME_QUEUE,
      GAME_JOBS.CLEANUP,
      {},
      { delay: cleanupIntervalMs },
    );

    return { failed: stuck.length };
  }

  /**
   * Stuck means one of three things, and the first is the subtle one: **more than
   * one RUNNING round at a time**. That should be impossible, and if it happens
   * the newest is the real one - the others are orphans from a process that died
   * mid-transition and would otherwise hold their players' bets forever.
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
