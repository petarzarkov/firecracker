import { SQLiteError } from 'bun:sqlite';
import { Logger } from '@dunx/core';
import { SyncDatabase, transactionSync } from '@dunx/infra/db';
import { HttpError, HttpStatusCode } from '@dunx/http';
import type { Page, PageOptions } from '@dunx/infra/pagination';
import { AppConfigService } from '../../config/app.config.service.js';
import * as schema from '../../infra/db/schema.js';
import type { DbHandle } from '../../infra/db/tx.js';
import { payoutCents } from '../game.math.js';
import { GameBetStatus, type GameBetRow } from '../schema/game-bet.schema.js';
import { WalletTransactionType } from '../schema/wallet.schema.js';
import {
  GameBetRepository,
  type BetWithPlayer,
} from '../repos/game-bet.repository.js';
import { WalletRepository } from '../repos/wallet.repository.js';
import type { RefundedBet } from './game-round.service.js';
import { WalletService } from './wallet.service.js';

/**
 * A bet or cash-out the player is not allowed to make. Always a 400, and the
 * message is written to be shown to them - the gateway puts it straight into a
 * `betAck`, so it must never carry internals.
 */
export class BetRejected extends HttpError {
  override name = 'BetRejected';
  constructor(message: string) {
    super(HttpStatusCode.BAD_REQUEST, message);
  }
}

/**
 * Placing and settling bets - the one place in the app where two players' money
 * and one shared round meet.
 *
 * ## The advisory lock is gone, and nothing replaced it
 *
 * The Postgres version wrapped both mutations in
 * `pg_try_advisory_xact_lock(hash('game_bet_<user>_<round>_<mode>'))` and answered
 * "please try again" when the lock was already held. That existed to stop a player
 * double-betting or double-cashing-out by firing two sockets at once.
 *
 * Three things together mean this code needs none of it:
 *
 *  1. **`transactionSync` cannot yield.** The callback's return type refuses a promise, so
 *     an `async` one is a type error rather than a transaction that commits
 *     before its first `await` resumes. Inside one process, read-check-write is
 *     atomic by construction - there is no point at which a second request can
 *     interleave, because JavaScript is not going to run one.
 *  2. **The debit is guarded in SQL**, `WHERE balance_cents >= ?`, so an
 *     overdraft is impossible even against the other process.
 *  3. **`game_bet_round_user_demo_index` is unique**, so the second of two bets
 *     racing from *different* processes fails on the constraint. That is the case
 *     the lock genuinely covered, and the index covers it without a round trip.
 *
 * What this buys beyond deleting a service: the old code answered a lost race with
 * "could not place bet - please try again", which is a retry prompt for something
 * that was never going to succeed. Here the same race produces the real answer:
 * "you already have an active bet in this round".
 */
export class GameBetService {
  constructor(
    private readonly bets: GameBetRepository,
    private readonly wallets: WalletService,
    private readonly db: SyncDatabase<typeof schema>,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  /**
   * Debit the wallet and open a bet, or reject and write nothing.
   *
   * Everything happens in one synchronous transaction: the balance check, the
   * debit, the bet row and the ledger row commit together or not at all.
   */
  placeBet(
    userId: string,
    roundId: string,
    betAmountCents: number,
    isDemo = false,
  ): GameBetRow {
    const { minBetCents } = this.config.get('game');
    if (!Number.isInteger(betAmountCents) || betAmountCents < minBetCents) {
      throw new BetRejected(
        `Minimum bet is ${minBetCents} cents ($${(minBetCents / 100).toFixed(2)})`,
      );
    }

    try {
      return transactionSync(this.db, (tx) => {
        const betRepo = GameBetRepository.over(tx);
        const walletRepo = WalletRepository.over(tx);

        const existing = betRepo.findActiveByRoundAndUser(
          roundId,
          userId,
          isDemo,
        );
        if (existing !== undefined) throw new BetRejected(alreadyBet(isDemo));

        const wallet = walletRepo.findByUserId(userId, isDemo);
        if (wallet === undefined) {
          throw new BetRejected(
            isDemo
              ? 'Demo wallet not found - please reconnect'
              : 'Wallet not found. Please contact support.',
          );
        }

        const debited = this.wallets.debit(
          wallet.id,
          betAmountCents,
          WalletTransactionType.BET_DEBIT,
          `${isDemo ? 'Demo bet' : 'Bet'} placed in round ${roundId}`,
          null,
          walletRepo,
        );
        if (debited === undefined) {
          throw new BetRejected(
            isDemo
              ? 'Insufficient demo balance'
              : 'Insufficient wallet balance',
          );
        }

        const bet = betRepo.create({
          roundId,
          userId,
          betAmountCents,
          isDemo,
          status: GameBetStatus.ACTIVE,
        });

        this.logger.info('bet placed', {
          userId,
          roundId,
          betAmountCents,
          isDemo,
          remainingBalance: debited.balanceCents,
        });
        return bet;
      });
    } catch (error) {
      // The cross-process race, arriving as the unique index refusing the second
      // insert. The transaction has already rolled back, so the debit went with
      // it - there is nothing to compensate, only a message to translate.
      if (isDuplicateBet(error)) throw new BetRejected(alreadyBet(isDemo));
      throw error;
    }
  }

  /**
   * Close a bet at `multiplierX100` and pay it out.
   *
   * The multiplier is a parameter rather than something read here, and that is
   * deliberate: the caller captures it from the engine **synchronously**, before
   * anything can await, so a player is paid the number that was on their screen
   * rather than whatever it had climbed to by the time the write landed.
   */
  cashOut(
    userId: string,
    roundId: string,
    multiplierX100: number,
    isDemo = false,
  ): GameBetRow {
    return transactionSync(this.db, (tx) => {
      const betRepo = GameBetRepository.over(tx);
      const walletRepo = WalletRepository.over(tx);

      const bet = betRepo.findActiveByRoundAndUser(roundId, userId, isDemo);
      if (bet === undefined) {
        throw new BetRejected('No active bet found for this round');
      }

      const payout = payoutCents(bet.betAmountCents, multiplierX100);

      const settled = betRepo.update(bet.id, {
        status: GameBetStatus.CASHED_OUT,
        cashedOutAtX100: multiplierX100,
        payoutCents: payout,
      });
      if (settled === undefined) {
        throw new BetRejected('No active bet found for this round');
      }

      const wallet = walletRepo.findByUserId(userId, isDemo);
      if (wallet === undefined) {
        throw new BetRejected('Wallet not found. Please contact support.');
      }

      this.wallets.credit(
        wallet.id,
        payout,
        WalletTransactionType.WIN_CREDIT,
        `${isDemo ? 'Demo cashout' : 'Cashout'} at ${(multiplierX100 / 100).toFixed(2)}x in round ${roundId}`,
        settled.id,
        walletRepo,
      );

      this.logger.info('bet cashed out', {
        userId,
        roundId,
        multiplierX100,
        payoutCents: payout,
        isDemo,
      });
      return settled;
    });
  }

  /**
   * Give every open bet in a round its stake back. Called inside the caller's
   * transaction - `tx` is not optional, because a refund that commits separately
   * from the round being marked FAILED can be applied twice by a retried job.
   */
  refundBetsForRound(roundId: string, tx: DbHandle): RefundedBet[] {
    const betRepo = GameBetRepository.over(tx);
    const walletRepo = WalletRepository.over(tx);
    const refunds: RefundedBet[] = [];

    for (const bet of betRepo.findActiveByRound(roundId)) {
      const wallet = walletRepo.findByUserId(bet.userId, bet.isDemo);
      if (wallet === undefined) {
        this.logger.error('cannot refund a bet whose wallet is missing', {
          betId: bet.id,
          userId: bet.userId,
        });
        continue;
      }

      const credited = this.wallets.credit(
        wallet.id,
        bet.betAmountCents,
        WalletTransactionType.REFUND,
        `Refund for failed round ${roundId}`,
        bet.id,
        walletRepo,
      );
      betRepo.update(bet.id, { status: GameBetStatus.REFUNDED });

      refunds.push({
        userId: bet.userId,
        isDemo: bet.isDemo,
        balanceCents: credited.balanceCents,
        refundedCents: bet.betAmountCents,
      });
    }

    return refunds;
  }

  /** Everything still open when the rocket exploded. One statement, no loop. */
  settleAllBetsAsLost(roundId: string, tx: DbHandle): number {
    const lost = GameBetRepository.over(tx).settleActiveBetsAsLost(roundId);
    this.logger.info('active bets settled as lost', { roundId, lost });
    return lost;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  findActiveByRoundAndUser(
    roundId: string,
    userId: string,
    isDemo = false,
  ): GameBetRow | undefined {
    return this.bets.findActiveByRoundAndUser(roundId, userId, isDemo);
  }

  findByRoundWithPlayers(roundId: string): BetWithPlayer[] {
    return this.bets.findByRoundWithPlayers(roundId);
  }

  recentByUser(userId: string, limit = 20): GameBetRow[] {
    return this.bets.recentByUser(userId, limit);
  }

  listByUser(userId: string, options: PageOptions): Promise<Page<GameBetRow>> {
    return this.bets.listByUser(userId, options);
  }
}

const alreadyBet = (isDemo: boolean): string =>
  isDemo
    ? 'You already have an active demo bet in this round'
    : 'You already have an active bet in this round';

/**
 * The unique index refusing a second bet, as opposed to any other constraint.
 *
 * The index name is matched rather than just the code, because a
 * `SQLITE_CONSTRAINT_UNIQUE` from anywhere else in this transaction is a bug and
 * should not be reported to a player as "you already bet".
 */
const isDuplicateBet = (error: unknown): boolean =>
  error instanceof SQLiteError &&
  error.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
  error.message.includes('game_bet_round_user_demo_index');
