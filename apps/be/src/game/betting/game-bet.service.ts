import { SQLiteError } from 'bun:sqlite';
import { Logger } from '@dunx/core';
import { SyncDatabase, transactionSync } from '@dunx/infra/db';
import { HttpError, HttpStatusCode } from '@dunx/http';
import type { Page, PageOptions } from '@dunx/infra/pagination';
import { WalletTransactionType } from '@firecracker/contracts';
import { AppConfigService } from '../../config/app.config.service.js';
import type { AppSchema, DbHandle } from '../../infra/db/tx.js';
import { WalletService } from '../../wallet/services/wallet.service.js';
import { GameMath } from '../game.math.js';
import { GameBetStatus, type GameBetRow } from './game-bet.schema.js';
import {
  GameBetRepository,
  type BetWithCrash,
  type BetWithPlayer,
} from './game-bet.repository.js';

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
 * Placing and settling bets - the one place two players' money and one shared
 * round meet. No lock is taken and none is needed; CLAUDE.md, "There is no
 * advisory lock", is the argument, and the three legs are `transactionSync`, the
 * SQL-guarded debit and the unique index below.
 */
/** What `cancelBet` hands back, so the caller can tell the lobby and the wallet. */
export interface CancelledBet {
  readonly isDemo: boolean;
  readonly refundedCents: number;
  readonly balanceCents: number;
}

export class GameBetService {
  /**
   * `game_bet_round_user_demo_index`, **as the columns, not the index name**:
   * bun:sqlite words a violation as `UNIQUE constraint failed: game_bet.round_id,
   * …` and never names the index. Matching on the name made the predicate always
   * false, so a cross-process double bet reached the player as a raw 500.
   */
  static readonly #DUPLICATE_BET_COLUMNS =
    'game_bet.round_id, game_bet.user_id, game_bet.is_demo';

  /**
   * The constraint is identified, not just the code: a `SQLITE_CONSTRAINT_UNIQUE`
   * from anywhere else in this transaction is a bug, and must not be reported to a
   * player as "you already bet".
   */
  static #isDuplicateBet(error: unknown): boolean {
    return (
      error instanceof SQLiteError &&
      error.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
      error.message.includes(GameBetService.#DUPLICATE_BET_COLUMNS)
    );
  }

  static #alreadyBet(isDemo: boolean): string {
    return isDemo
      ? 'You already have an active demo bet in this round'
      : 'You already have an active bet in this round';
  }

  constructor(
    private readonly bets: GameBetRepository,
    private readonly wallets: WalletService,
    private readonly db: SyncDatabase<AppSchema>,
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

        const existing = betRepo.findActiveByRoundAndUser(
          roundId,
          userId,
          isDemo,
        );
        if (existing !== undefined)
          throw new BetRejected(GameBetService.#alreadyBet(isDemo));

        const wallet = this.wallets.findWallet(tx, userId, isDemo);
        if (wallet === undefined) {
          throw new BetRejected(
            isDemo
              ? 'Demo wallet not found - please reconnect'
              : 'Wallet not found. Please contact support.',
          );
        }

        const debited = this.wallets.debit(
          tx,
          wallet.id,
          betAmountCents,
          WalletTransactionType.BET_DEBIT,
          `${isDemo ? 'Demo bet' : 'Bet'} placed in round ${roundId}`,
          null,
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

        this.logger.debug('bet placed', {
          userId,
          roundId,
          betAmountCents,
          isDemo,
          remainingBalance: debited.balanceCents,
        });
        return bet;
      });
    } catch (error) {
      // The cross-process race. The transaction already rolled back and took the
      // debit with it, so there is nothing to compensate - only a message.
      if (GameBetService.#isDuplicateBet(error))
        throw new BetRejected(GameBetService.#alreadyBet(isDemo));
      throw error;
    }
  }

  /**
   * The multiplier is a parameter, not read here: the caller captures it from the
   * engine **synchronously**, so a player is paid the number that was on their
   * screen rather than whatever it had climbed to by the time the write landed.
   */
  cashOut(
    userId: string,
    roundId: string,
    multiplierX100: number,
    isDemo = false,
  ): GameBetRow {
    return transactionSync(this.db, (tx) => {
      const betRepo = GameBetRepository.over(tx);

      const bet = betRepo.findActiveByRoundAndUser(roundId, userId, isDemo);
      if (bet === undefined) {
        throw new BetRejected('No active bet found for this round');
      }

      const payout = GameMath.payoutCents(bet.betAmountCents, multiplierX100);

      const settled = betRepo.update(bet.id, {
        status: GameBetStatus.CASHED_OUT,
        cashedOutAtX100: multiplierX100,
        payoutCents: payout,
      });
      if (settled === undefined) {
        throw new BetRejected('No active bet found for this round');
      }

      const wallet = this.wallets.findWallet(tx, userId, isDemo);
      if (wallet === undefined) {
        throw new BetRejected('Wallet not found. Please contact support.');
      }

      this.wallets.credit(
        tx,
        wallet.id,
        payout,
        WalletTransactionType.WIN_CREDIT,
        `${isDemo ? 'Demo cashout' : 'Cashout'} at ${(multiplierX100 / 100).toFixed(2)}x in round ${roundId}`,
        settled.id,
      );

      this.logger.debug('bet cashed out', {
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
    const refunds: RefundedBet[] = [];

    for (const bet of betRepo.findActiveByRound(roundId)) {
      const wallet = this.wallets.findWallet(tx, bet.userId, bet.isDemo);
      if (wallet === undefined) {
        this.logger.error('cannot refund a bet whose wallet is missing', {
          betId: bet.id,
          userId: bet.userId,
        });
        continue;
      }

      const credited = this.wallets.credit(
        tx,
        wallet.id,
        bet.betAmountCents,
        WalletTransactionType.REFUND,
        `Refund for failed round ${roundId}`,
        bet.id,
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

  /**
   * Takes a bet back off the table, before the round it belongs to has launched.
   *
   * The row is **deleted** rather than marked refunded, because
   * `game_bet_round_user_demo_index` is unique over `(round_id, user_id, is_demo)`
   * whatever the status - a settled-but-present row would let the guard in
   * `placeBet` pass and then have the insert fail on the index, refusing a re-bet
   * with a message about an active bet that no longer exists.
   *
   * The money is not deleted with it: the ledger's `game_bet_id` is
   * `onDelete: 'set null'`, so the debit and this refund both stay on the wallet's
   * history. A cancelled bet is a bet that did not happen; the money that moved
   * still did.
   */
  cancelBet(userId: string, roundId: string): CancelledBet {
    return transactionSync(this.db, (tx) => {
      const betRepo = GameBetRepository.over(tx);

      const bet = betRepo.findActiveByRoundAndUserAnyMode(roundId, userId);
      if (bet === undefined) {
        throw new BetRejected('You have no bet on this round to cancel');
      }

      const wallet = this.wallets.findWallet(tx, userId, bet.isDemo);
      if (wallet === undefined) {
        throw new BetRejected('Wallet not found - please reconnect');
      }

      const credited = this.wallets.credit(
        tx,
        wallet.id,
        bet.betAmountCents,
        WalletTransactionType.REFUND,
        `Bet cancelled before launch in round ${roundId}`,
        bet.id,
      );
      betRepo.deleteById(bet.id);

      this.logger.debug('bet cancelled', {
        userId,
        roundId,
        refundedCents: bet.betAmountCents,
      });

      return {
        isDemo: bet.isDemo,
        refundedCents: bet.betAmountCents,
        balanceCents: credited.balanceCents,
      };
    });
  }

  /** Everything still open when the rocket exploded. One statement, no loop. */
  settleAllBetsAsLost(roundId: string, tx: DbHandle): number {
    const lost = GameBetRepository.over(tx).settleActiveBetsAsLost(roundId);
    this.logger.debug('active bets settled as lost', { roundId, lost });
    return lost;
  }

  findActiveByRoundAndUser(
    roundId: string,
    userId: string,
    isDemo = false,
  ): GameBetRow | undefined {
    return this.bets.findActiveByRoundAndUser(roundId, userId, isDemo);
  }

  /** The player's open bet in this round, whichever wallet it is against. */
  findActiveByRoundAndUserAnyMode(
    roundId: string,
    userId: string,
  ): GameBetRow | undefined {
    return this.bets.findActiveByRoundAndUserAnyMode(roundId, userId);
  }

  findByRoundWithPlayers(roundId: string): BetWithPlayer[] {
    return this.bets.findByRoundWithPlayers(roundId);
  }

  listByUser(userId: string, options: PageOptions): Page<BetWithCrash> {
    return this.bets.listByUser(userId, options);
  }
}

/**
 * One player's stake, handed back. Declared beside the method that produces it, so
 * `GameRoundService` importing it does not read as a mutual dependency.
 */
export interface RefundedBet {
  readonly userId: string;
  readonly isDemo: boolean;
  readonly balanceCents: number;
  readonly refundedCents: number;
}
