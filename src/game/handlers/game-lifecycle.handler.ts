import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { GAME } from '@/constants';
import { ContextLogger } from '@/infra/logger/services/context-logger.service';
import { JobHandler } from '@/infra/queue/decorators/job-handler.decorator';
import { JobPublisherService } from '@/infra/queue/services/job-publisher.service';
import { type JobHandlerPayload } from '@/infra/queue/types/queue-job.type';
import { RedisService } from '@/infra/redis/services/redis.service';
import { EVENTS } from '@/notifications/events/events';
import type { EngineCommand } from '../engine/crash-engine.service';
import { clientSeedsKey, GameGateway } from '../game.gateway';
import { DemoService } from '../services/demo.service';
import { GameRoundService } from '../services/game-round.service';

/** Redis pub/sub channel that the main-process CrashEngineService subscribes to. */
const GAME_ENGINE_CHANNEL = 'game:engine:commands';

@Injectable()
export class GameLifecycleHandler {
  private pub: Redis;

  constructor(
    private readonly gameRoundService: GameRoundService,
    private readonly demoService: DemoService,
    private readonly gameGateway: GameGateway,
    private readonly jobPublisher: JobPublisherService,
    private readonly redisService: RedisService,
    private readonly logger: ContextLogger,
  ) {
    this.pub = this.redisService.newConnection('game-engine-pub');
  }

  /**
   * Creates a new round in WAITING state, notifies clients, and
   * schedules the GAME_ROUND_START job after the waiting window.
   */
  @JobHandler({
    queue: EVENTS.QUEUES.BACKGROUND_JOBS,
    name: EVENTS.ROUTING_KEYS.GAME_ROUND_SCHEDULE,
  })
  async handleScheduleRound(
    _job: JobHandlerPayload<typeof EVENTS.ROUTING_KEYS.GAME_ROUND_SCHEDULE>,
  ): Promise<void> {
    const round = await this.gameRoundService.createNextRound();

    // Broadcast phase change to all clients via Redis emitter
    this.gameGateway.emitPhaseChange({
      phase: 'waiting',
      roundId: round.id,
      seedHash: round.seedHash,
      nonce: round.nonce,
      waitingEndsAt: round.waitingEndsAt?.toISOString(),
    });

    // Tell the main-process engine to update its in-memory state
    await this.#publishEngineCommand({
      action: 'waiting',
      roundId: round.id,
      seedHash: round.seedHash,
      waitingEndsAt: round.waitingEndsAt?.toISOString(),
    });

    await this.jobPublisher.publishJob(
      EVENTS.ROUTING_KEYS.GAME_ROUND_START,
      { roundId: round.id },
      {
        delay: GAME.WAITING_PHASE_MS,
        jobId: `game-round-start-${round.id}`,
        queue: EVENTS.QUEUES.BACKGROUND_JOBS,
      },
    );

    this.logger.log('Round scheduled', {
      roundId: round.id,
      waitingEndsAt: round.waitingEndsAt,
    });
  }

  /**
   * Transitions the round to RUNNING and starts the crash engine tick loop
   * in the main process via a Redis pub/sub command.
   */
  @JobHandler({
    queue: EVENTS.QUEUES.BACKGROUND_JOBS,
    name: EVENTS.ROUTING_KEYS.GAME_ROUND_START,
  })
  async handleStartRound(
    job: JobHandlerPayload<typeof EVENTS.ROUTING_KEYS.GAME_ROUND_START>,
  ): Promise<void> {
    const { roundId } = job.data.payload;

    // Collect all player-submitted seeds from Redis, then clean up the key
    const seedsKey = clientSeedsKey(roundId);
    const seedsHash = await this.pub.hgetall(seedsKey);
    const playerSeeds = Object.values(seedsHash ?? {});
    if (playerSeeds.length > 0) {
      await this.pub.del(seedsKey);
    }

    const round = await this.gameRoundService.transitionToRunning(
      roundId,
      playerSeeds,
    );

    // Broadcast phase change to all clients via Redis emitter
    this.gameGateway.emitPhaseChange({
      phase: 'running',
      roundId: round.id,
      seedHash: round.seedHash,
      nonce: round.nonce,
    });

    // Tell the main-process engine to start the tick loop
    await this.#publishEngineCommand({
      action: 'start',
      roundId: round.id,
      crashPoint: Number(round.crashPoint),
      startedAt: (round.startedAt ?? new Date()).toISOString(),
    });

    this.logger.log('Round started', {
      roundId: round.id,
      playerSeedsCount: playerSeeds.length,
    });
  }

  /**
   * Settles all bets, notifies clients of the crash, and schedules the next round.
   */
  @JobHandler({
    queue: EVENTS.QUEUES.BACKGROUND_JOBS,
    name: EVENTS.ROUTING_KEYS.GAME_ROUND_CRASH,
  })
  async handleCrashRound(
    job: JobHandlerPayload<typeof EVENTS.ROUTING_KEYS.GAME_ROUND_CRASH>,
  ): Promise<void> {
    const { roundId } = job.data.payload;

    const round = await this.gameRoundService.transitionToCrashed(roundId);

    // Settle demo bets in Redis
    await this.demoService.settleDemoBets(roundId);

    // Tell the main-process engine to stop the tick loop
    await this.#publishEngineCommand({ action: 'crash' });

    // Broadcast crash to all clients via Redis emitter
    // Reveal seed, clientSeed, nonce so players can verify independently
    this.gameGateway.emitCrashed({
      roundId: round.id,
      crashPoint: Number(round.crashPoint),
      crashedAt: round.crashedAt ?? new Date(),
      seed: round.seed,
      clientSeed: round.clientSeed ?? 'firecracker',
      nonce: Number(round.nonce),
    });

    // Schedule next round after cooldown
    await this.jobPublisher.publishJob(
      EVENTS.ROUTING_KEYS.GAME_ROUND_SCHEDULE,
      {},
      {
        delay: GAME.COOLDOWN_MS,
        jobId: `game-round-schedule-after-${roundId}`,
        queue: EVENTS.QUEUES.BACKGROUND_JOBS,
      },
    );

    this.logger.log('Round crashed — next round scheduled', {
      roundId: round.id,
      crashPoint: round.crashPoint,
    });
  }

  async #publishEngineCommand(command: EngineCommand): Promise<void> {
    await this.pub.publish(GAME_ENGINE_CHANNEL, JSON.stringify(command));
  }
}
