import { Logger } from '@dunx/core';
import { SyncDatabase, transactionSync } from '@dunx/infra/db';
import { RedisConnection } from '@dunx/infra/redis';
import type { Page, PageOptions } from '@dunx/infra/pagination';
import { AppConfigService } from '../../config/app.config.service.js';
import * as schema from '../../infra/db/schema.js';
import { Fairness } from '../fairness/fairness.js';
import {
  GameRoundStatus,
  type GameRoundRow,
} from '../schema/game-round.schema.js';
import { GameRoundRepository } from '../repos/game-round.repository.js';
import { GameBetService, type RefundedBet } from './game-bet.service.js';

/** Where the monotonic per-round nonce lives. One `INCR`, no contention. */
const NONCE_KEY = 'game:round:nonce';

/**
 * The lifecycle of a round, and the provably-fair record that goes with it.
 *
 * The order of operations here is the fairness guarantee and is not free to
 * change: the server seed is committed (as its hash) when the round is *created*,
 * the players contribute entropy during WAITING, and only at the transition to
 * RUNNING - once the window is shut - is the crash point drawn. Drawing it any
 * earlier would mean the players' seeds could not have influenced it; drawing it
 * any later would mean we chose it knowing the bets.
 *
 * The values themselves live in `fairness/fairness.ts`, which has no container
 * behind it. This class decides *when* each one is produced, which is the half a
 * unit test cannot see.
 */
export class GameRoundService {
  /** Per-round hash of player-submitted client seeds, written during WAITING. */
  static clientSeedsKey(roundId: string): string {
    return `game:client-seeds:${roundId}`;
  }

  constructor(
    private readonly rounds: GameRoundRepository,
    private readonly bets: GameBetService,
    private readonly db: SyncDatabase<typeof schema>,
    private readonly redis: RedisConnection,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  /** Atomically increments and returns the round nonce. */
  nextNonce(): Promise<number> {
    return this.redis.incr(NONCE_KEY);
  }

  /**
   * A new round in WAITING, with the seed committed and the crash point still
   * undrawn. `crashPointX100` stays null until `transitionToRunning`.
   */
  async createNextRound(): Promise<GameRoundRow> {
    const seed = Fairness.serverSeed();
    const seedHash = Fairness.commit(seed);
    const nonce = await this.nextNonce();
    const waitingEndsAt = new Date(
      Date.now() + this.config.get('game').waitingPhaseMs,
    );

    const round = this.rounds.create({
      seed,
      seedHash,
      nonce,
      clientSeed: null,
      crashPointX100: null,
      rngAlgorithm: Fairness.DEFAULT_ALGORITHM,
      status: GameRoundStatus.WAITING,
      waitingEndsAt,
    });

    this.logger.debug('game round created', {
      roundId: round.id,
      nonce,
      waitingEndsAt,
    });
    return round;
  }

  /**
   * The round the loop is currently driving, if there is one.
   *
   * `GameJobs.schedule` guards on this: the schedule job is enqueued from three
   * places - boot recovery, the watchdog after a cleanup, and the cooldown after a
   * crash - and only the third can scope a `jobId` to a round. A *fixed* id for the
   * other two would be worse than none, because bullmq dedupes against the completed
   * set too, so the id that stopped ten restarts making ten loops would also stop the
   * eleventh restart making any. Guarding on state is the same reason the stuck-round
   * sweep is a schedule rather than a self-rescheduling job.
   */
  currentRound(): GameRoundRow | undefined {
    return this.rounds.findCurrentRound();
  }

  /**
   * Close the betting window and draw the crash point.
   *
   * The transition is conditional on the round still being WAITING, so two workers
   * racing on the same round produce one start and one no-op. The loser gets
   * `undefined` and returns it - a retried job must not launch a round twice.
   */
  async transitionToRunning(
    roundId: string,
  ): Promise<GameRoundRow | undefined> {
    const round = this.rounds.findById(roundId);
    if (round === undefined || round.status !== GameRoundStatus.WAITING) {
      return undefined;
    }

    // A read failure must not become an empty pool. `combineClientSeeds([])` is the
    // constant `'firecracker'`, so a round launched without the seeds would draw its
    // crash point from the server seed alone - a value the house committed at
    // creation and can therefore compute in advance - while recording itself as
    // provably fair. Worse, the record of that round is byte-for-byte identical to
    // an idle lobby's, so nothing distinguishes the degraded case afterwards.
    //
    // Rounds need Redis. Leaving this one WAITING is the honest answer: the stuck
    // round sweep picks it up, and no round claims entropy it did not have.
    const submitted = await this.#clientSeeds(roundId);
    if (submitted === null) return undefined;

    const clientSeed = Fairness.combine(Object.values(submitted));

    const crashPoint = Fairness.crashPointX100(
      round.seed,
      clientSeed,
      round.nonce,
      Fairness.DEFAULT_ALGORITHM,
    );

    const started = this.rounds.transition(roundId, GameRoundStatus.WAITING, {
      status: GameRoundStatus.RUNNING,
      clientSeed,
      crashPointX100: crashPoint,
      rngAlgorithm: Fairness.DEFAULT_ALGORITHM,
      startedAt: new Date(),
    });

    if (started === undefined) {
      this.logger.warn('round was already started by another worker', {
        roundId,
      });
      return undefined;
    }

    this.logger.debug('game round running', {
      roundId,
      crashPointX100: crashPoint,
      seedCount: Object.keys(submitted).length,
    });
    return started;
  }

  /**
   * The submitted client seeds, or `null` when Redis could not be asked.
   *
   * The distinction is the whole point. An empty hash is normal - an idle lobby has
   * no players and therefore no seeds. An unreachable Redis is not, and the two used
   * to be the same value.
   */
  async #clientSeeds(roundId: string): Promise<Record<string, string> | null> {
    try {
      return await this.redis.hgetall(GameRoundService.clientSeedsKey(roundId));
    } catch (error) {
      this.logger.error('cannot launch a round without its client seeds', {
        roundId,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Settle the round: mark it crashed and lose every bet still open.
   *
   * One transaction, because a crashed round whose bets are still ACTIVE would let
   * a late cash-out through. `transactionSync` rather than `transaction`: the
   * callback is synchronous, so this commits without ever yielding, and no
   * concurrent request can observe the half-settled state.
   */
  settleCrash(roundId: string): GameRoundRow | undefined {
    return transactionSync(this.db, (tx) => {
      const crashed = GameRoundRepository.over(tx).transition(
        roundId,
        GameRoundStatus.RUNNING,
        { status: GameRoundStatus.CRASHED, crashedAt: new Date() },
      );
      if (crashed === undefined) return undefined;

      this.bets.settleAllBetsAsLost(roundId, tx);
      return crashed;
    });
  }

  /**
   * Fail a stuck round and refund everything still riding on it. Returns the
   * per-player refunds so the caller can tell them.
   */
  failAndRefund(roundId: string): {
    refunds: readonly RefundedBet[];
    round: GameRoundRow | undefined;
  } {
    return transactionSync(this.db, (tx) => {
      const rounds = GameRoundRepository.over(tx);
      const round = rounds.findById(roundId);
      if (round === undefined) return { refunds: [], round: undefined };

      const refunds = this.bets.refundBetsForRound(roundId, tx);
      const failed = rounds.transition(roundId, round.status, {
        status: GameRoundStatus.FAILED,
        crashedAt: new Date(),
      });

      // `debug`, not `warn`: the caller knows whether one failed round is news.
      // `GameRoundWatchdog` sweeps a backlog and reports it as one line, and this
      // was the second half of the two-per-round pair that made that unreadable.
      this.logger.debug('game round failed and refunded', {
        roundId,
        refunded: refunds.length,
      });
      return { refunds, round: failed };
    });
  }

  getCurrentRound(): GameRoundRow | undefined {
    return this.rounds.findCurrentRound();
  }

  getRecentCrashes(limit: number): GameRoundRow[] {
    return this.rounds.findRecentCrashes(limit);
  }

  getById(id: string): GameRoundRow | undefined {
    return this.rounds.findById(id);
  }

  list(options: PageOptions): Page<GameRoundRow> {
    return this.rounds.list(options);
  }

  /**
   * Everything a player needs to check a finished round themselves, including the
   * exact string that was fed to the generator and the algorithm it was drawn
   * with. Refuses a round that has not crashed yet - handing out the server seed
   * while bets are open would let anyone read the outcome.
   */
  verification(roundId: string): RoundProof | undefined {
    const round = this.rounds.findById(roundId);
    if (
      round === undefined ||
      round.status !== GameRoundStatus.CRASHED ||
      round.clientSeed === null ||
      round.crashPointX100 === null
    ) {
      return undefined;
    }

    return {
      roundId: round.id,
      serverSeed: round.seed,
      serverSeedHash: round.seedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      algorithm: round.rngAlgorithm,
      rngSeed: Fairness.seedString(round.seed, round.clientSeed, round.nonce),
      crashPointX100: round.crashPointX100,
    };
  }
}

/**
 * The proof as it comes off the round row: hundredths, and no instructions.
 *
 * Named apart from the `RoundVerification` **response** in `game.dto.ts`, which is
 * this converted at the edge with `howToVerify` attached. They were both called
 * `RoundVerification`, so a reader had to check the import to know which shape a
 * variable held.
 */
export interface RoundProof {
  readonly roundId: string;
  readonly serverSeed: string;
  readonly serverSeedHash: string;
  readonly clientSeed: string;
  readonly nonce: number;
  readonly algorithm: string;
  readonly rngSeed: string;
  readonly crashPointX100: number;
}
