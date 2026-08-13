import { Logger, type OnInit, type OnShutdown } from '@dunx/core';
import { JobPublisher } from '@dunx/infra/queue';
import { RedisConnection } from '@dunx/infra/redis';
import { AppConfigService } from '../../config/app.config.service.js';
import { EventsPublisher } from '../../notifications/events/events.publisher.js';
import {
  GAME_EVENTS,
  GAME_JOBS,
  GAME_QUEUE,
  GAME_TOPIC,
} from '../game.events.js';
import { multiplierAtX100, toMultiplier } from '../game.math.js';
import { GameRoundStatus } from '../schema/game-round.schema.js';
import { GameRoundRepository } from '../repos/game-round.repository.js';

/** Where the worker tells the web process what the round just became. */
export const GAME_ENGINE_CHANNEL = 'game:engine:commands';

/**
 * What a worker publishes on {@link GAME_ENGINE_CHANNEL}.
 *
 * The worker owns the database transitions and the web process owns the clock, so
 * this is the only thing crossing between them. Note `crashPointX100`: the command
 * carries hundredths like everything else, so the engine's comparison never leaves
 * integer space.
 */
export type EngineCommand =
  | { action: 'waiting'; roundId: string }
  | {
      action: 'start';
      roundId: string;
      crashPointX100: number;
      startedAt: string;
    }
  | { action: 'crash' };

/** A cash-out the engine triggers on the player's behalf when the curve reaches it. */
export interface AutoCashOut {
  readonly userId: string;
  readonly username: string;
  readonly autoCashOutAtX100: number;
  readonly isDemo: boolean;
}

/**
 * The clock. It holds the current round in memory, ticks the multiplier, and
 * decides the moment of the crash.
 *
 * ## One process, and why
 *
 * The tick loop must run in **exactly one** process. Two would each publish their
 * own crash job and each broadcast their own ticks, so a client would see the
 * multiplier stutter between two timelines. `GameModule.forRoot({ engine: false })`
 * is what keeps it out of the worker, and it is also why the `app` service in
 * docker-compose.prod.yml cannot be scaled to two replicas as it stands.
 *
 * The database is the truth and this is a cache of it: everything here is
 * recoverable from `game_round` at boot, which is what `#recover` does.
 *
 * ## The tick emitter is gone
 *
 * The NestJS version had `registerTickEmitter()` and `registerAutoCashOutHandler()`
 * - two callbacks the gateway installed on `onModuleInit` to break a circular
 * module import between engine and gateway. dunx records dependencies as a thunk
 * evaluated at resolution, so a cycle resolves on its own and neither callback is
 * needed: this class injects `EventsPublisher` and publishes ticks itself.
 */
export class CrashEngineService implements OnInit, OnShutdown {
  // ── In-memory state. The database is canonical; this is the clock's copy. ──
  #roundId: string | null = null;
  #phase: GameRoundStatus | null = null;
  #startedAt: Date | null = null;
  #crashPointX100: number | null = null;
  #crashedAt: Date | null = null;
  #tick: ReturnType<typeof setInterval> | null = null;

  /** Set by the gateway, which owns the Redis hash the auto-cashouts live in. */
  #autoCashOut: ((roundId: string, multiplierX100: number) => void) | null =
    null;

  constructor(
    private readonly rounds: GameRoundRepository,
    private readonly jobs: JobPublisher,
    private readonly redis: RedisConnection,
    private readonly events: EventsPublisher,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  async onInit(): Promise<void> {
    await this.#recover();
    await this.#listenForCommands();
    await this.#bootstrapCleanup();
  }

  onShutdown(): void {
    this.#clear();
  }

  // ── What the gateway and the controller read ──────────────────────────────

  get roundId(): string | null {
    return this.#roundId;
  }

  get phase(): GameRoundStatus | null {
    return this.#phase;
  }

  /**
   * The multiplier right now, in hundredths, or `null` when no round is running.
   *
   * **Read this synchronously and pass the value on.** A cash-out that re-reads it
   * after an `await` pays whatever the curve had climbed to in the meantime, not
   * what the player saw when they clicked.
   */
  currentMultiplierX100(): number | null {
    if (this.#phase !== GameRoundStatus.RUNNING || this.#startedAt === null) {
      return null;
    }
    return multiplierAtX100(
      Date.now() - this.#startedAt.getTime(),
      this.config.get('game').multiplierDivisor,
    );
  }

  /**
   * The crash multiplier, if the round crashed within the grace window.
   *
   * A player whose click left the browser before the crash should not be punished
   * for their round-trip time, so a cash-out arriving just after settles at the
   * crash point rather than being refused.
   */
  graceMultiplierX100(): number | null {
    if (
      this.#phase !== GameRoundStatus.CRASHED ||
      this.#crashedAt === null ||
      this.#crashPointX100 === null
    ) {
      return null;
    }
    const grace = this.config.get('game').cashoutGraceMs;
    return Date.now() - this.#crashedAt.getTime() <= grace
      ? this.#crashPointX100
      : null;
  }

  registerAutoCashOutHandler(
    fn: (roundId: string, multiplierX100: number) => void,
  ): void {
    this.#autoCashOut = fn;
  }

  // ── Transitions, driven by the worker over pub/sub ────────────────────────

  setWaiting(roundId: string): void {
    this.#clear();
    this.#roundId = roundId;
    this.#phase = GameRoundStatus.WAITING;
    this.#startedAt = null;
    this.#crashPointX100 = null;
  }

  startRunning(roundId: string, crashPointX100: number, startedAt: Date): void {
    this.#roundId = roundId;
    this.#phase = GameRoundStatus.RUNNING;
    this.#startedAt = startedAt;
    this.#crashPointX100 = crashPointX100;
    this.#clear();
    this.#tick = setInterval(
      () => this.#onTick(),
      this.config.get('game').tickIntervalMs,
    );
    this.logger.info('engine ticking', { roundId, crashPointX100 });
  }

  setCrashed(): void {
    this.#clear();
    this.#phase = GameRoundStatus.CRASHED;
    this.#crashedAt = new Date();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Pick up whatever round was in flight when this process last died.
   *
   * Three cases, and the third is the one that matters: a round that should have
   * crashed while we were down is crashed immediately rather than resumed, because
   * resuming it would tick past its crash point and pay out bets that lost.
   */
  async #recover(): Promise<void> {
    const round = this.rounds.findCurrentRound();

    if (round === undefined) {
      this.logger.info('no active round at boot, scheduling the first');
      await this.#enqueue(GAME_JOBS.SCHEDULE, {});
      return;
    }

    if (round.status === GameRoundStatus.WAITING) {
      const remaining =
        round.waitingEndsAt === null
          ? 0
          : Math.max(0, round.waitingEndsAt.getTime() - Date.now());
      this.setWaiting(round.id);
      await this.#enqueue(
        GAME_JOBS.START,
        { roundId: round.id },
        { delay: remaining, jobId: `game-round-start-${round.id}` },
      );
      this.logger.info('recovered a waiting round', {
        roundId: round.id,
        remaining,
      });
      return;
    }

    if (round.status === GameRoundStatus.RUNNING && round.startedAt !== null) {
      const { multiplierDivisor } = this.config.get('game');
      const now = multiplierAtX100(
        Date.now() - round.startedAt.getTime(),
        multiplierDivisor,
      );

      if (round.crashPointX100 !== null && now >= round.crashPointX100) {
        this.logger.warn('round should have crashed while we were down', {
          roundId: round.id,
          nowX100: now,
          crashPointX100: round.crashPointX100,
        });
        await this.#enqueue(
          GAME_JOBS.CRASH,
          { roundId: round.id },
          { jobId: `game-round-crash-${round.id}` },
        );
        return;
      }

      if (round.crashPointX100 !== null) {
        this.startRunning(round.id, round.crashPointX100, round.startedAt);
      }
    }
  }

  /**
   * Kick the watchdog loop off once, from the process that owns the engine.
   *
   * A fixed `jobId` is what makes a restart idempotent: BullMQ refuses a second
   * job with an id already in the queue, so a process that restarts ten times does
   * not end up with ten cleanup loops running in parallel. The *reschedule* inside
   * the handler deliberately does not do this - see `GameJobs.cleanup`.
   */
  async #bootstrapCleanup(): Promise<void> {
    await this.#enqueue(
      GAME_JOBS.CLEANUP,
      {},
      {
        delay: this.config.get('game').cleanupIntervalMs,
        jobId: 'game-round-cleanup-bootstrap',
      },
    );
  }

  /**
   * `RedisConnection.subscribe` opens its own second connection - a client in
   * subscriber mode refuses every data command - so this needs no separate
   * client of its own. The NestJS version managed that connection by hand.
   */
  async #listenForCommands(): Promise<void> {
    try {
      await this.redis.subscribe(GAME_ENGINE_CHANNEL, (message) => {
        let command: EngineCommand;
        try {
          command = JSON.parse(message) as EngineCommand;
        } catch {
          this.logger.error('malformed engine command', { message });
          return;
        }

        if (command.action === 'waiting') {
          this.setWaiting(command.roundId);
        } else if (command.action === 'start') {
          this.startRunning(
            command.roundId,
            command.crashPointX100,
            new Date(command.startedAt),
          );
        } else {
          this.setCrashed();
        }
      });
    } catch (error) {
      // Redis down at boot. The app still serves - what stops is the game, and
      // that is visible on the health endpoint rather than as a failed boot.
      this.logger.error('engine could not subscribe for commands', {
        reason: (error as Error).message,
      });
    }
  }

  #onTick(): void {
    if (this.#startedAt === null || this.#crashPointX100 === null) return;

    const elapsed = Date.now() - this.#startedAt.getTime();
    const multiplierX100 = multiplierAtX100(
      elapsed,
      this.config.get('game').multiplierDivisor,
    );

    if (multiplierX100 >= this.#crashPointX100) {
      this.#clear();
      this.#phase = GameRoundStatus.CRASHED;
      this.#crashedAt = new Date();

      const roundId = this.#roundId;
      if (roundId === null) return;

      this.logger.info('crash point reached', {
        roundId,
        crashPointX100: this.#crashPointX100,
      });

      // Fire and forget: the settlement is the worker's job, and a tick handler
      // that awaited it would hold the clock while the database wrote.
      void this.#enqueue(
        GAME_JOBS.CRASH,
        { roundId },
        { jobId: `game-round-crash-${roundId}` },
      );
      return;
    }

    if (this.#roundId !== null)
      this.#autoCashOut?.(this.#roundId, multiplierX100);

    this.events.publish(GAME_TOPIC, GAME_EVENTS.TICK, {
      multiplier: toMultiplier(multiplierX100),
      elapsed,
    });
  }

  /**
   * Enqueue, and **never throw**.
   *
   * This is load-bearing, and a test caught it being wrong. `onInit` runs during
   * boot, so an enqueue that rejects against an unreachable Redis takes the whole
   * process down with it - which breaks the one promise the rest of this app makes
   * about its dependencies: an absent Redis degrades a *route*, never the graph.
   *
   * With no broker the game does not advance, and that is the honest outcome. It
   * is visible on `/api/service/health` as a degraded queue, and it recovers on the
   * next boot rather than leaving a process that cannot start.
   */
  async #enqueue(
    name: string,
    data: object,
    options: { delay?: number; jobId?: string } = {},
  ): Promise<void> {
    try {
      await this.jobs.publish(GAME_QUEUE, name, data, options);
    } catch (error) {
      this.logger.warn('could not enqueue a game job', {
        name,
        reason: (error as Error).message,
      });
    }
  }

  #clear(): void {
    if (this.#tick !== null) {
      clearInterval(this.#tick);
      this.#tick = null;
    }
  }
}
