import { Injectable, OnModuleInit } from '@nestjs/common';
import { GAME } from '@/constants';
import { ContextLogger } from '@/infra/logger/services/context-logger.service';
import { JobHandler } from '@/infra/queue/decorators/job-handler.decorator';
import { JobPublisherService } from '@/infra/queue/services/job-publisher.service';
import { type JobHandlerPayload } from '@/infra/queue/types/queue-job.type';
import { EVENTS } from '@/notifications/events/events';
import { GameRound } from '../entity/game-round.entity';
import { GameRoundStatus } from '../enum/game-round-status.enum';
import { GameGateway } from '../game.gateway';
import { GameRoundRepository } from '../repos/game-round.repository';
import { GameRoundService } from '../services/game-round.service';

/** Fixed BullMQ jobId — prevents duplicate cleanup jobs piling up in the queue. */
const CLEANUP_JOB_ID = 'game-round-cleanup-periodic';

@Injectable()
export class GameCleanupHandler implements OnModuleInit {
  constructor(
    private readonly gameRoundRepo: GameRoundRepository,
    private readonly gameRoundService: GameRoundService,
    private readonly gameGateway: GameGateway,
    private readonly jobPublisher: JobPublisherService,
    private readonly logger: ContextLogger,
  ) {}

  /**
   * Bootstrap the cleanup loop from the main process only.
   * BullMQ deduplicates by jobId so restarts don't pile up jobs.
   */
  onModuleInit(): void {
    if (process.env.IS_JOB_WORKER === 'true') return;

    void this.jobPublisher
      .publishJob(
        EVENTS.ROUTING_KEYS.GAME_ROUND_CLEANUP,
        {},
        {
          jobId: CLEANUP_JOB_ID,
          queue: EVENTS.QUEUES.BACKGROUND_JOBS,
        },
      )
      .catch(err =>
        this.logger.error('Failed to bootstrap cleanup job', { err }),
      );
  }

  @JobHandler({
    queue: EVENTS.QUEUES.BACKGROUND_JOBS,
    name: EVENTS.ROUTING_KEYS.GAME_ROUND_CLEANUP,
  })
  async handleCleanup(
    _job: JobHandlerPayload<typeof EVENTS.ROUTING_KEYS.GAME_ROUND_CLEANUP>,
  ): Promise<void> {
    const active = await this.gameRoundRepo.findAllActiveRounds();
    const stuck = this.#identifyStuck(active);

    for (const round of stuck) {
      try {
        const { refunds } = await this.gameRoundService.transitionToFailed(
          round.id,
        );
        for (const { userId, isDemo, balanceCents } of refunds) {
          this.gameGateway.emitWalletUpdated(userId, balanceCents, isDemo);
        }
        this.logger.warn('Round failed by cleanup job', {
          roundId: round.id,
          status: round.status,
          refundCount: refunds.length,
        });
      } catch (err) {
        this.logger.error('Failed to fail stuck round', {
          roundId: round.id,
          err,
        });
      }
    }

    // If all active rounds were stuck and cleaned up, restart the game loop
    const healthy = active.filter(r => !stuck.includes(r));
    if (healthy.length === 0 && stuck.length > 0) {
      await this.jobPublisher.publishJob(
        EVENTS.ROUTING_KEYS.GAME_ROUND_SCHEDULE,
        {},
        { queue: EVENTS.QUEUES.BACKGROUND_JOBS },
      );
      this.logger.warn('No active round after cleanup — restarted game loop');
    }

    // Reschedule self — no jobId here so BullMQ assigns a fresh unique ID.
    // Using the fixed CLEANUP_JOB_ID would be silently deduped by BullMQ
    // because the just-completed job with that ID is still in the completed
    // set (removeOnComplete: { age: 3600 }).
    await this.jobPublisher.publishJob(
      EVENTS.ROUTING_KEYS.GAME_ROUND_CLEANUP,
      {},
      {
        delay: GAME.CLEANUP_INTERVAL_MS,
        queue: EVENTS.QUEUES.BACKGROUND_JOBS,
      },
    );
  }

  /**
   * Identifies which rounds are stuck based on age and multiplicity.
   *
   * Rules:
   * - Multiple RUNNING rounds: keep newest startedAt, fail the rest
   * - Single RUNNING round older than threshold: fail
   * - WAITING round with waitingEndsAt older than threshold: fail
   */
  #identifyStuck(rounds: GameRound[]): GameRound[] {
    const now = Date.now();
    const threshold = GAME.STUCK_ROUND_THRESHOLD_MS;

    const running = rounds.filter(r => r.status === GameRoundStatus.RUNNING);
    const waiting = rounds.filter(r => r.status === GameRoundStatus.WAITING);
    const stuck: GameRound[] = [];

    // Multiple RUNNING: keep newest, fail the rest
    if (running.length > 1) {
      const sorted = [...running].sort(
        (a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0),
      );
      stuck.push(...sorted.slice(1));
    }

    // Single RUNNING that has been running too long
    for (const r of running) {
      if (
        !stuck.includes(r) &&
        r.startedAt &&
        now - r.startedAt.getTime() > threshold
      ) {
        stuck.push(r);
      }
    }

    // WAITING rounds whose window closed long ago
    for (const r of waiting) {
      if (r.waitingEndsAt && now - r.waitingEndsAt.getTime() > threshold) {
        stuck.push(r);
      }
    }

    return stuck;
  }
}
