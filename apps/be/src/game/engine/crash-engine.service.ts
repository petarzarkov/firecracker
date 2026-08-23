import { Logger, type OnInit, type OnShutdown } from '@dunx/core';
import { JobPublisher } from '@dunx/infra/queue';
import { RedisConnection } from '@dunx/infra/redis';
import { ScheduleKind, ScheduleRegistry } from '@dunx/infra/schedule';
import { AppConfigService } from '../../config/app.config.service.js';
import { EventsPublisher } from '../../notifications/events/events.publisher.js';
import {
  GAME_EVENTS,
  GAME_JOBS,
  GAME_QUEUE,
  GAME_TOPIC,
  publishGame,
} from '../game.events.js';
import { GameMath } from '../game.math.js';
import { GameRoundStatus } from '../rounds/game-round.schema.js';
import { GameRoundRepository } from '../rounds/game-round.repository.js';
import { GAME_ENGINE_CHANNEL, type EngineCommand } from './engine.commands.js';

/**
 * The clock: the current round in memory, the multiplier ticking, and the moment
 * of the crash.
 *
 * The tick loop must run in **exactly one** process or a client sees the multiplier
 * stutter between two timelines, which is why `EngineModule` is decorated and
 * carries no static factory - dunx dedupes a decorated module by reference, where a
 * `forRoot()` would hand each importer its own engine.
 *
 * `game_round` is the truth and this is a cache of it, recoverable at boot by
 * `#recover`. The auto-cashout handler is a callback rather than an injection so
 * the clock has no path to the wallet.
 */
export class CrashEngineService implements OnInit, OnShutdown {
  // In-memory state. The database is canonical; this is the clock's copy.
  #roundId: string | null = null;
  #phase: GameRoundStatus | null = null;
  #startedAt: Date | null = null;
  #crashPointX100: number | null = null;
  #crashedAt: Date | null = null;
  /** Whether {@link CrashEngineService.TICK} is currently armed. */
  #ticking = false;

  /** Set from outside, by whoever owns the Redis hash the auto-cashouts live in. */
  #autoCashOut: ((roundId: string, multiplierX100: number) => void) | null =
    null;

  /** Fixed rather than per-round, so re-arming cannot leak an entry per round. */
  static readonly TICK = 'game.round.tick';

  constructor(
    private readonly rounds: GameRoundRepository,
    private readonly jobs: JobPublisher,
    private readonly redis: RedisConnection,
    private readonly events: EventsPublisher,
    private readonly schedules: ScheduleRegistry,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  async onInit(): Promise<void> {
    await this.#recover();
    await this.#listenForCommands();
  }

  onShutdown(): void {
    this.#clear();
  }

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
    return GameMath.multiplierAtX100(
      Date.now() - this.#startedAt.getTime(),
      this.config.get('game').multiplierDivisor,
    );
  }

  /**
   * The crash multiplier if the round crashed within the grace window: a player
   * whose click left the browser before the crash should not be punished for their
   * round-trip time.
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

  /**
   * Where this round stopped, once it has. `null` until then - handing it out
   * earlier would be handing out the outcome while bets are still open.
   */
  get crashPointX100(): number | null {
    return this.#phase === GameRoundStatus.CRASHED
      ? this.#crashPointX100
      : null;
  }

  registerAutoCashOutHandler(
    fn: (roundId: string, multiplierX100: number) => void,
  ): void {
    this.#autoCashOut = fn;
  }

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
    // Disarm before arming: the registry refuses a duplicate name, so a repeated
    // `start` command would throw on the pub/sub path instead of re-arming.
    this.#clear();
    this.schedules.add(
      {
        kind: ScheduleKind.INTERVAL,
        at: this.config.get('game').tickIntervalMs,
        name: CrashEngineService.TICK,
      },
      () => this.#onTick(),
    );
    this.#ticking = true;
    this.logger.debug('engine ticking', { roundId, crashPointX100 });
  }

  setCrashed(): void {
    this.#clear();
    this.#phase = GameRoundStatus.CRASHED;
    this.#crashedAt = new Date();
  }

  /**
   * Pick up whatever round was in flight when this process last died. The third
   * case is the one that matters: a round that should have crashed while we were
   * down is crashed rather than resumed, or it pays out bets that lost.
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
      // **No `jobId`.** `RoundJobs.schedule` already enqueued one as
      // `game-round-start-<id>`, and bullmq dedupes against the *completed* set as
      // well as the pending one - so reusing that id here is a no-op whenever the
      // job has already run, and the round then waits forever with nothing left to
      // start it. `transitionToRunning` is guarded on `status = WAITING`, so a
      // second start is a no-op where a missing one is a dead lobby. Same reasoning
      // as `GameRoundService.currentRound`.
      await this.#enqueue(
        GAME_JOBS.START,
        { roundId: round.id },
        { delay: remaining },
      );
      this.logger.info('recovered a waiting round', {
        roundId: round.id,
        remaining,
      });
      return;
    }

    if (round.status === GameRoundStatus.RUNNING && round.startedAt !== null) {
      const { multiplierDivisor } = this.config.get('game');
      const now = GameMath.multiplierAtX100(
        Date.now() - round.startedAt.getTime(),
        multiplierDivisor,
      );

      if (round.crashPointX100 !== null && now >= round.crashPointX100) {
        this.logger.warn('round should have crashed while we were down', {
          roundId: round.id,
          nowX100: now,
          crashPointX100: round.crashPointX100,
        });
        // No `jobId`, for the reason above: the engine may already have enqueued
        // and completed `game-round-crash-<id>` before it died. `settleCrash`
        // transitions from RUNNING only, so a second crash settles nothing twice.
        await this.#enqueue(GAME_JOBS.CRASH, { roundId: round.id });
        return;
      }

      if (round.crashPointX100 !== null) {
        this.startRunning(round.id, round.crashPointX100, round.startedAt);
      }
    }
  }

  /**
   * `RedisConnection.subscribe` opens its own second connection - a client in
   * subscriber mode refuses every data command - so this needs no separate
   * client of its own.
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
    const multiplierX100 = GameMath.multiplierAtX100(
      elapsed,
      this.config.get('game').multiplierDivisor,
    );

    if (multiplierX100 >= this.#crashPointX100) {
      this.#clear();
      this.#phase = GameRoundStatus.CRASHED;
      this.#crashedAt = new Date();

      const roundId = this.#roundId;
      if (roundId === null) return;

      this.logger.debug('crash point reached', {
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

    publishGame(this.events, GAME_TOPIC, GAME_EVENTS.TICK, {
      multiplier: GameMath.toMultiplier(multiplierX100),
      elapsed,
    });
  }

  /**
   * Enqueue, and **never throw**. `onInit` runs during boot, so a rejection against
   * an unreachable Redis would take the process down - breaking the promise the
   * rest of the app keeps, that an absent Redis degrades a route and never the
   * graph. With no broker the game stops advancing, which the health endpoint says.
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

  /** Stops the clock. Called from four places, so it has to be idempotent. */
  #clear(): void {
    if (!this.#ticking) return;
    this.schedules.remove(CrashEngineService.TICK);
    this.#ticking = false;
  }
}
