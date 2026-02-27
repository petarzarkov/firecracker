import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { GAME } from '@/constants';
import { PageDto } from '@/core/pagination/dto/page.dto';
import { PageOptionsDto } from '@/core/pagination/dto/page-options.dto';
import { PgLockService } from '@/infra/db/lock/pg-lock.service';
import { ContextLogger } from '@/infra/logger/services/context-logger.service';
import { GameBet } from '../entity/game-bet.entity';
import { Wallet } from '../entity/wallet.entity';
import { GameBetStatus } from '../enum/game-bet-status.enum';
import { WalletTransactionType } from '../enum/wallet-transaction-type.enum';
import { GameBetRepository } from '../repos/game-bet.repository';
import { WalletRepository } from '../repos/wallet.repository';
import { WalletTransactionRepository } from '../repos/wallet-transaction.repository';

@Injectable()
export class GameBetService {
  constructor(
    private readonly gameBetRepo: GameBetRepository,
    private readonly walletRepo: WalletRepository,
    private readonly walletTxnRepo: WalletTransactionRepository,
    private readonly pgLockService: PgLockService,
    private readonly logger: ContextLogger,
  ) {}

  /**
   * Places a bet for an authenticated user.
   * Protected by an advisory lock to prevent duplicate bets in the same round.
   * Pass isDemo=true to debit the demo wallet and record a demo bet.
   */
  async placeBet(
    userId: string,
    roundId: string,
    betAmountCents: number,
    _currentMultiplierFn: () => void,
    isDemo = false,
  ): Promise<GameBet> {
    if (betAmountCents < GAME.MIN_BET_CENTS) {
      throw new BadRequestException(
        `Minimum bet is ${GAME.MIN_BET_CENTS} cents ($${GAME.MIN_BET_CENTS / 100})`,
      );
    }

    const lockKey = `game_bet_${userId}_${roundId}_${isDemo ? 'demo' : 'real'}`;
    const result = await this.pgLockService.withLock(lockKey, async manager => {
      const existing = await this.gameBetRepo.findActiveByRoundAndUser(
        roundId,
        userId,
        isDemo,
      );
      if (existing) {
        throw new BadRequestException(
          isDemo
            ? 'You already have an active demo bet in this round'
            : 'You already have an active bet in this round',
        );
      }

      const wallet = await manager.findOneBy(Wallet, { userId, isDemo });
      if (!wallet) {
        throw new BadRequestException(
          isDemo
            ? 'Demo wallet not found — please reconnect'
            : 'Wallet not found. Please contact support.',
        );
      }

      if (wallet.balanceCents < betAmountCents) {
        throw new BadRequestException(
          isDemo ? 'Insufficient demo balance' : 'Insufficient wallet balance',
        );
      }

      const affected = await this.walletRepo.debitCents(
        wallet.id,
        betAmountCents,
        manager,
      );
      if (affected === 0) {
        throw new BadRequestException(
          isDemo ? 'Insufficient demo balance' : 'Insufficient wallet balance',
        );
      }

      const updatedWallet = await manager.findOneByOrFail(Wallet, {
        id: wallet.id,
      });

      const bet = this.gameBetRepo.create({
        roundId,
        userId,
        betAmountCents,
        isDemo,
        status: GameBetStatus.ACTIVE,
      });
      await this.gameBetRepo.save(bet, manager);

      const txn = this.walletTxnRepo.create({
        walletId: wallet.id,
        type: WalletTransactionType.BET_DEBIT,
        amountCents: betAmountCents,
        balanceAfterCents: updatedWallet.balanceCents,
        gameBetId: bet.id,
        description: `${isDemo ? 'Demo bet' : 'Bet'} placed in round ${roundId}`,
      });
      await this.walletTxnRepo.save(txn, manager);

      this.logger.log('Bet placed', {
        userId,
        roundId,
        betAmountCents,
        isDemo,
        remainingBalance: updatedWallet.balanceCents,
      });

      return bet;
    });

    if (result === 'not_locked') {
      throw new BadRequestException('Could not place bet — please try again');
    }

    return result;
  }

  /**
   * Cashes out a bet at the current multiplier.
   * The multiplier must be captured synchronously before any async operations.
   * Pass isDemo=true to credit the demo wallet.
   */
  async cashOut(
    userId: string,
    roundId: string,
    currentMultiplier: number,
    isDemo = false,
  ): Promise<GameBet> {
    const lockKey = `game_cashout_${userId}_${roundId}_${isDemo ? 'demo' : 'real'}`;
    const result = await this.pgLockService.withLock(lockKey, async manager => {
      const bet = await this.gameBetRepo.findActiveByRoundAndUser(
        roundId,
        userId,
        isDemo,
      );
      if (!bet) {
        throw new BadRequestException('No active bet found for this round');
      }

      const payoutCents = Math.floor(bet.betAmountCents * currentMultiplier);

      bet.status = GameBetStatus.CASHED_OUT;
      bet.cashedOutAt = currentMultiplier;
      bet.payoutCents = payoutCents;
      await this.gameBetRepo.save(bet, manager);

      const wallet = await manager.findOneByOrFail(Wallet, { userId, isDemo });
      await this.walletRepo.creditCents(wallet.id, payoutCents, manager);

      const updatedWallet = await manager.findOneByOrFail(Wallet, {
        id: wallet.id,
      });

      const txn = this.walletTxnRepo.create({
        walletId: wallet.id,
        type: WalletTransactionType.WIN_CREDIT,
        amountCents: payoutCents,
        balanceAfterCents: updatedWallet.balanceCents,
        gameBetId: bet.id,
        description: `${isDemo ? 'Demo cashout' : 'Cashout'} at ${currentMultiplier}x in round ${roundId}`,
      });
      await this.walletTxnRepo.save(txn, manager);

      this.logger.log('Bet cashed out', {
        userId,
        roundId,
        multiplier: currentMultiplier,
        payoutCents,
        isDemo,
      });

      return bet;
    });

    if (result === 'not_locked') {
      throw new BadRequestException('Could not cash out — please try again');
    }

    return result;
  }

  /**
   * Refunds all active bets in a round back to each player's wallet.
   * Called within an existing DB transaction when a round is failed by the
   * cleanup job. Returns per-user refund data for WS notification.
   */
  async refundBetsForRound(
    roundId: string,
    manager: EntityManager,
  ): Promise<Array<{ userId: string; isDemo: boolean; balanceCents: number }>> {
    const bets = await this.gameBetRepo.findActiveBetsByRound(roundId);
    const results: Array<{
      userId: string;
      isDemo: boolean;
      balanceCents: number;
    }> = [];

    for (const bet of bets) {
      const wallet = await manager.findOneByOrFail(Wallet, {
        userId: bet.userId,
        isDemo: bet.isDemo,
      });

      await this.walletRepo.creditCents(wallet.id, bet.betAmountCents, manager);

      const updatedWallet = await manager.findOneByOrFail(Wallet, {
        id: wallet.id,
      });

      const txn = this.walletTxnRepo.create({
        walletId: wallet.id,
        type: WalletTransactionType.REFUND,
        amountCents: bet.betAmountCents,
        balanceAfterCents: updatedWallet.balanceCents,
        gameBetId: bet.id,
        description: `Refund for failed round ${roundId}`,
      });
      await this.walletTxnRepo.save(txn, manager);

      bet.status = GameBetStatus.REFUNDED;
      await this.gameBetRepo.save(bet, manager);

      results.push({
        userId: bet.userId,
        isDemo: bet.isDemo,
        balanceCents: updatedWallet.balanceCents,
      });
    }

    this.logger.log('Bets refunded for failed round', {
      roundId,
      count: bets.length,
    });

    return results;
  }

  /**
   * Marks all active bets in a round as LOST (real and demo).
   * Called within an existing DB transaction during round crash settlement.
   */
  async settleAllBets(roundId: string, manager: EntityManager): Promise<void> {
    await this.gameBetRepo.settleActiveBetsAsLost(roundId, manager);
    this.logger.log('All active bets settled as LOST', { roundId });
  }

  findActiveByRoundAndUser(
    roundId: string,
    userId: string,
    isDemo = false,
  ): Promise<GameBet | null> {
    return this.gameBetRepo.findActiveByRoundAndUser(roundId, userId, isDemo);
  }

  findByRoundId(roundId: string): Promise<GameBet[]> {
    return this.gameBetRepo.findByRoundId(roundId);
  }

  getUserBets(
    userId: string,
    pageOptions: PageOptionsDto,
  ): Promise<PageDto<GameBet>> {
    return this.gameBetRepo.findByUserPaginated(userId, pageOptions);
  }
}
