import { Rng } from '@arkv/rng';
import { Logger } from '@dunx/core';
import { SyncDatabase, transactionSync } from '@dunx/infra/db';
import { RedisConnection } from '@dunx/infra/redis';
import type { Page, PageOptions } from '@dunx/infra/pagination';
import { AppConfigService } from '../../config/app.config.service.js';
import * as schema from '../../infra/db/schema.js';
import {
  crashPointX100,
  DEFAULT_RNG_ALGORITHM,
  fairnessSeed,
} from '../game.math.js';
import {
  GameRoundStatus,
  type GameRoundRow,
} from '../schema/game-round.schema.js';
import { GameRoundRepository } from '../repos/game-round.repository.js';
import { GameBetService } from './game-bet.service.js';

/** Where the monotonic per-round nonce lives. One `INCR`, no contention. */
const NONCE_KEY = 'game:round:nonce';

/** Per-round hash of player-submitted client seeds, written during WAITING. */
export const clientSeedsKey = (roundId: string): string =>
  `game:client-seeds:${roundId}`;

/**
 * The lifecycle of a round, and the provably-fair record that goes with it.
 *
 * The order of operations here is the fairness guarantee and is not free to
 * change: the server seed is committed (as its hash) when the round is *created*,
 * the players contribute entropy during WAITING, and only at the transition to
 * RUNNING - once the window is shut - is the crash point drawn. Drawing it any
 * earlier would mean the players' seeds could not have influenced it; drawing it
 * any later would mean we chose it knowing the bets.
 */
export class GameRoundService {
  constructor(
    private readonly rounds: GameRoundRepository,
    private readonly bets: GameBetService,
    private readonly db: SyncDatabase<typeof schema>,
    private readonly redis: RedisConnection,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  /**
   * 32 bytes from the platform CSPRNG.
   *
   * **Deliberately not `@arkv/rng`.** This value is published after the round
   * crashes, and every algorithm that package offers is a non-cryptographic PRNG
   * whose internal state is recoverable from a handful of outputs. A player
   * collecting revealed seeds could then predict every future crash point. The
   * draw in `game.math.ts` is seeded *from* this and may be a PRNG precisely
   * because it is reproducible on purpose; this one must not be.
   */
  generateSeed(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString('hex');
  }

  /**
   * The commitment: `SHA256(seed)`, published before the round starts so a player
   * can check afterwards that the seed was not swapped for a more convenient one.
   */
  generateSeedHash(seed: string): string {
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(seed);
    return hasher.digest('hex');
  }

  /**
   * Every player's seed folded into one value.
   *
   * Sorted before hashing so the result cannot depend on the order submissions
   * happened to arrive in - otherwise a player who could influence arrival order
   * could influence the outcome.
   */
  combineClientSeeds(seeds: readonly string[]): string {
    if (seeds.length === 0) return 'firecracker';
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update([...seeds].sort().join(':'));
    return hasher.digest('hex');
  }

  /**
   * A random 16-byte client seed, contributed on a player's behalf when they place
   * a bet without submitting one of their own.
   *
   * `@arkv/rng` here and not for the server seed: this value is public the moment
   * it is used, it only has to vary, and nothing about the game's security rests
   * on it being unpredictable.
   */
  autoClientSeed(): string {
    const rng = new Rng();
    try {
      const words = rng.ints(4);
      return Array.from(words, (w) => w.toString(16).padStart(8, '0')).join('');
    } finally {
      rng.free();
    }
  }

  /** Atomically increments and returns the round nonce. */
  nextNonce(): Promise<number> {
    return this.redis.incr(NONCE_KEY);
  }

  /**
   * A new round in WAITING, with the seed committed and the crash point still
   * undrawn. `crashPointX100` stays null until `transitionToRunning`.
   */
  async createNextRound(): Promise<GameRoundRow> {
    const seed = this.generateSeed();
    const seedHash = this.generateSeedHash(seed);
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
      rngAlgorithm: DEFAULT_RNG_ALGORITHM,
      status: GameRoundStatus.WAITING,
      waitingEndsAt,
    });

    this.logger.info('game round created', {
      roundId: round.id,
      nonce,
      waitingEndsAt,
    });
    return round;
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

    const submitted = await this.redis
      .hgetall(clientSeedsKey(roundId))
      .catch(() => ({}) as Record<string, string>);
    const clientSeed = this.combineClientSeeds(Object.values(submitted));

    const crashPoint = crashPointX100(
      round.seed,
      clientSeed,
      round.nonce,
      DEFAULT_RNG_ALGORITHM,
    );

    const started = this.rounds.transition(roundId, GameRoundStatus.WAITING, {
      status: GameRoundStatus.RUNNING,
      clientSeed,
      crashPointX100: crashPoint,
      rngAlgorithm: DEFAULT_RNG_ALGORITHM,
      startedAt: new Date(),
    });

    if (started === undefined) {
      this.logger.warn('round was already started by another worker', {
        roundId,
      });
      return undefined;
    }

    this.logger.info('game round running', {
      roundId,
      crashPointX100: crashPoint,
      seedCount: Object.keys(submitted).length,
    });
    return started;
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

      this.logger.warn('game round failed and refunded', {
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

  list(options: PageOptions): Promise<Page<GameRoundRow>> {
    return this.rounds.list(options);
  }

  /**
   * Everything a player needs to check a finished round themselves, including the
   * exact string that was fed to the generator and the algorithm it was drawn
   * with. Refuses a round that has not crashed yet - handing out the server seed
   * while bets are open would let anyone read the outcome.
   */
  verification(roundId: string): RoundVerification | undefined {
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
      rngSeed: fairnessSeed(round.seed, round.clientSeed, round.nonce),
      crashPointX100: round.crashPointX100,
    };
  }
}

export interface RefundedBet {
  readonly userId: string;
  readonly isDemo: boolean;
  readonly balanceCents: number;
  readonly refundedCents: number;
}

export interface RoundVerification {
  readonly roundId: string;
  readonly serverSeed: string;
  readonly serverSeedHash: string;
  readonly clientSeed: string;
  readonly nonce: number;
  readonly algorithm: string;
  readonly rngSeed: string;
  readonly crashPointX100: number;
}
