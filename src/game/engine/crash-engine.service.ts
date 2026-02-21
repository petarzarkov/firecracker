import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { GAME } from '@/constants';
import { ContextLogger } from '@/infra/logger/services/context-logger.service';
import { JobPublisherService } from '@/infra/queue/services/job-publisher.service';
import { RedisService } from '@/infra/redis/services/redis.service';
import { EVENTS } from '@/notifications/events/events';
import { GameRoundStatus } from '../enum/game-round-status.enum';
import { GameRoundRepository } from '../repos/game-round.repository';

/** Redis pub/sub channel used by background workers to command the main-process engine. */
const GAME_ENGINE_CHANNEL = 'game:engine:commands';

/** Commands published to GAME_ENGINE_CHANNEL by GameLifecycleHandler. */
export type EngineCommand =
  | {
      action: 'waiting';
      roundId: string;
      seedHash: string;
      waitingEndsAt?: string;
    }
  | {
      action: 'start';
      roundId: string;
      crashPoint: number;
      startedAt: string;
    }
  | { action: 'crash' };

@Injectable()
export class CrashEngineService implements OnModuleInit, OnModuleDestroy {
  // ── In-memory game state (runtime cache — DB is the canonical truth) ────
  private currentRoundId: string | null = null;
  private currentPhase: GameRoundStatus | null = null;
  private roundStartedAt: Date | null = null;
  private crashPoint: number | null = null;
  private tickInterval: NodeJS.Timeout | null = null;

  /** Registered by GameGateway.onModuleInit() to avoid circular module imports. */
  private tickEmitter: ((multiplier: number, elapsed: number) => void) | null =
    null;

  constructor(
    private readonly gameRoundRepo: GameRoundRepository,
    private readonly jobPublisher: JobPublisherService,
    private readonly redisService: RedisService,
    private readonly logger: ContextLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    // Background workers set this env var before bootstrapping NestJS.
    // Skip the tick loop and pub/sub subscription in those processes.
    if (process.env.IS_JOB_WORKER === 'true') return;

    await this.#recoverOrSchedule();
    this.#subscribeToEngineCommands();
  }

  onModuleDestroy(): void {
    this.#clearTick();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Start the multiplier tick loop for a round that just transitioned to RUNNING.
   * Called by the pub/sub handler when a 'start' command arrives from a worker,
   * or directly during recovery.
   */
  startRunning(roundId: string, crashPoint: number, startedAt: Date): void {
    this.currentRoundId = roundId;
    this.currentPhase = GameRoundStatus.RUNNING;
    this.roundStartedAt = startedAt;
    this.crashPoint = crashPoint;
    this.#clearTick();
    this.tickInterval = setInterval(() => this.#tick(), GAME.TICK_INTERVAL_MS);
    this.logger.log('Crash engine started tick loop', { roundId, crashPoint });
  }

  /**
   * Returns the current multiplier. Throws if round is not RUNNING.
   * Must be called synchronously before any async cashout operations.
   */
  getCurrentMultiplier(): number {
    if (this.currentPhase !== GameRoundStatus.RUNNING || !this.roundStartedAt) {
      throw new Error('No active running round');
    }
    return this.#computeMultiplier(Date.now() - this.roundStartedAt.getTime());
  }

  getCurrentRoundId(): string | null {
    return this.currentRoundId;
  }

  getCurrentPhase(): GameRoundStatus | null {
    return this.currentPhase;
  }

  /**
   * Called when a round enters the WAITING phase.
   * Invoked by the pub/sub handler ('waiting' command) or during recovery.
   */
  setWaiting(roundId: string): void {
    this.#clearTick();
    this.currentRoundId = roundId;
    this.currentPhase = GameRoundStatus.WAITING;
    this.roundStartedAt = null;
    this.crashPoint = null;
  }

  /**
   * Called when the round has crashed and is fully settled.
   * Invoked by the pub/sub handler ('crash' command) or during recovery.
   */
  setCrashed(): void {
    this.#clearTick();
    this.currentPhase = GameRoundStatus.CRASHED;
  }

  /**
   * Called by GameGateway.onModuleInit() to wire tick broadcasts without
   * creating a circular module import between the two files.
   */
  registerTickEmitter(fn: (multiplier: number, elapsed: number) => void): void {
    this.tickEmitter = fn;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * On startup, recover whatever round was active when the process last died.
   * Falls back to scheduling a fresh round if nothing is active.
   */
  async #recoverOrSchedule(): Promise<void> {
    const round = await this.gameRoundRepo.findCurrentRound();

    if (!round) {
      this.logger.log(
        'No active round found at startup — scheduling first round',
      );
      await this.jobPublisher.publishJob(
        EVENTS.ROUTING_KEYS.GAME_ROUND_SCHEDULE,
        {},
        {
          jobId: 'game-round-schedule-init',
          queue: EVENTS.QUEUES.BACKGROUND_JOBS,
        },
      );
      return;
    }

    this.logger.log('Recovering active round after restart', {
      roundId: round.id,
      status: round.status,
    });

    if (round.status === GameRoundStatus.WAITING) {
      const remainingMs = round.waitingEndsAt
        ? Math.max(0, round.waitingEndsAt.getTime() - Date.now())
        : 0;

      this.setWaiting(round.id);
      await this.jobPublisher.publishJob(
        EVENTS.ROUTING_KEYS.GAME_ROUND_START,
        { roundId: round.id },
        {
          delay: remainingMs,
          jobId: `game-round-start-${round.id}`,
          queue: EVENTS.QUEUES.BACKGROUND_JOBS,
        },
      );
      return;
    }

    if (round.status === GameRoundStatus.RUNNING && round.startedAt) {
      const elapsed = Date.now() - round.startedAt.getTime();
      const currentMultiplier = this.#computeMultiplier(elapsed);

      if (currentMultiplier >= Number(round.crashPoint)) {
        // Should have crashed — trigger immediately
        this.logger.warn(
          'Round should have crashed during downtime — crashing now',
          {
            roundId: round.id,
            currentMultiplier,
            crashPoint: round.crashPoint,
          },
        );
        await this.jobPublisher.publishJob(
          EVENTS.ROUTING_KEYS.GAME_ROUND_CRASH,
          { roundId: round.id },
          {
            jobId: `game-round-crash-${round.id}`,
            queue: EVENTS.QUEUES.BACKGROUND_JOBS,
          },
        );
        return;
      }

      // Resume ticking
      this.startRunning(round.id, Number(round.crashPoint), round.startedAt);
    }
  }

  /**
   * Subscribe to the Redis pub/sub channel where background workers publish
   * engine commands after completing DB transitions.
   * Only runs in the main process (guarded by IS_JOB_WORKER check above).
   */
  #subscribeToEngineCommands(): void {
    const sub = this.redisService.newConnection('game-engine-sub');
    sub.subscribe(GAME_ENGINE_CHANNEL, err => {
      if (err) {
        this.logger.error('Failed to subscribe to game engine channel', {
          err,
        });
      }
    });

    sub.on('message', (_channel: string, message: string) => {
      let cmd: EngineCommand;
      try {
        cmd = JSON.parse(message) as EngineCommand;
      } catch {
        this.logger.error('Received malformed engine command', { message });
        return;
      }

      if (cmd.action === 'waiting') {
        this.setWaiting(cmd.roundId);
        this.logger.log('Engine: round entered WAITING', {
          roundId: cmd.roundId,
        });
      } else if (cmd.action === 'start') {
        this.startRunning(cmd.roundId, cmd.crashPoint, new Date(cmd.startedAt));
        this.logger.log('Engine: round started via pub/sub', {
          roundId: cmd.roundId,
          crashPoint: cmd.crashPoint,
        });
      } else if (cmd.action === 'crash') {
        this.setCrashed();
        this.logger.log('Engine: round crashed via pub/sub');
      }
    });
  }

  #tick(): void {
    if (!this.roundStartedAt || !this.crashPoint) return;

    const elapsed = Date.now() - this.roundStartedAt.getTime();
    const multiplier = this.#computeMultiplier(elapsed);

    if (multiplier >= this.crashPoint) {
      this.#clearTick();
      this.currentPhase = GameRoundStatus.CRASHED;

      const roundId = this.currentRoundId ?? 'unknown';
      this.logger.log('Crash point reached', {
        roundId,
        multiplier,
        crashPoint: this.crashPoint,
      });

      // Fire-and-forget: publish the crash job to the background workers queue
      this.jobPublisher
        .publishJob(
          EVENTS.ROUTING_KEYS.GAME_ROUND_CRASH,
          { roundId },
          {
            jobId: `game-round-crash-${roundId}`,
            queue: EVENTS.QUEUES.BACKGROUND_JOBS,
          },
        )
        .catch(err =>
          this.logger.error('Failed to publish crash job', { err }),
        );
      return;
    }

    this.tickEmitter?.(multiplier, elapsed);
  }

  #computeMultiplier(elapsedMs: number): number {
    return (
      Math.floor(Math.exp(elapsedMs / GAME.MULTIPLIER_DIVISOR) * 100) / 100
    );
  }

  #clearTick(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }
}
