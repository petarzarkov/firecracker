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
   * Places a real-money bet for an authenticated user.
   * Protected by an advisory lock to prevent duplicate bets in the same round.
   */
  async placeBet(
    userId: string,
    roundId: string,
    betAmountCents: number,
    _currentMultiplierFn: () => void, // unused here, but verifies round is WAITING via caller
  ): Promise<GameBet> {
    if (betAmountCents < GAME.MIN_BET_CENTS) {
      throw new BadRequestException(
        `Minimum bet is ${GAME.MIN_BET_CENTS} cents ($${GAME.MIN_BET_CENTS / 100})`,
      );
    }

    const result = await this.pgLockService.withLock(
      `game_bet_${userId}_${roundId}`,
      async manager => {
        // Check for existing active bet in this round
        const existing = await this.gameBetRepo.findActiveByRoundAndUser(
          roundId,
          userId,
        );
        if (existing) {
          throw new BadRequestException(
            'You already have an active bet in this round',
          );
        }

        // Get wallet and check balance
        const wallet = await manager.findOneBy(Wallet, { userId });
        if (!wallet) {
          throw new BadRequestException(
            'Wallet not found. Please contact support.',
          );
        }

        if (wallet.balanceCents < betAmountCents) {
          throw new BadRequestException('Insufficient wallet balance');
        }

        // Atomic debit: only succeeds if balance is still sufficient
        const affected = await this.walletRepo.debitCents(
          wallet.id,
          betAmountCents,
          manager,
        );
        if (affected === 0) {
          throw new BadRequestException('Insufficient wallet balance');
        }

        const updatedWallet = await manager.findOneByOrFail(Wallet, {
          id: wallet.id,
        });

        // Create bet
        const bet = this.gameBetRepo.create({
          roundId,
          userId,
          betAmountCents,
          status: GameBetStatus.ACTIVE,
        });
        await this.gameBetRepo.save(bet, manager);

        // Record wallet transaction
        const txn = this.walletTxnRepo.create({
          walletId: wallet.id,
          type: WalletTransactionType.BET_DEBIT,
          amountCents: betAmountCents,
          balanceAfterCents: updatedWallet.balanceCents,
          gameBetId: bet.id,
          description: `Bet placed in round ${roundId}`,
        });
        await this.walletTxnRepo.save(txn, manager);

        this.logger.log('Bet placed', {
          userId,
          roundId,
          betAmountCents,
          remainingBalance: updatedWallet.balanceCents,
        });

        return bet;
      },
    );

    if (result === 'not_locked') {
      throw new BadRequestException('Could not place bet — please try again');
    }

    return result;
  }

  /**
   * Cashes out a bet at the current multiplier.
   * The multiplier must be captured synchronously before any async operations.
   */
  async cashOut(
    userId: string,
    roundId: string,
    currentMultiplier: number,
  ): Promise<GameBet> {
    const result = await this.pgLockService.withLock(
      `game_cashout_${userId}_${roundId}`,
      async manager => {
        const bet = await this.gameBetRepo.findActiveByRoundAndUser(
          roundId,
          userId,
        );
        if (!bet) {
          throw new BadRequestException('No active bet found for this round');
        }

        const payoutCents = Math.floor(bet.betAmountCents * currentMultiplier);

        bet.status = GameBetStatus.CASHED_OUT;
        bet.cashedOutAt = currentMultiplier;
        bet.payoutCents = payoutCents;
        await this.gameBetRepo.save(bet, manager);

        // Credit wallet
        const wallet = await manager.findOneByOrFail(Wallet, { userId });
        await this.walletRepo.creditCents(wallet.id, payoutCents, manager);

        const updatedWallet = await manager.findOneByOrFail(Wallet, {
          id: wallet.id,
        });

        // Record wallet transaction
        const txn = this.walletTxnRepo.create({
          walletId: wallet.id,
          type: WalletTransactionType.WIN_CREDIT,
          amountCents: payoutCents,
          balanceAfterCents: updatedWallet.balanceCents,
          gameBetId: bet.id,
          description: `Cashout at ${currentMultiplier}x in round ${roundId}`,
        });
        await this.walletTxnRepo.save(txn, manager);

        this.logger.log('Bet cashed out', {
          userId,
          roundId,
          multiplier: currentMultiplier,
          payoutCents,
        });

        return bet;
      },
    );

    if (result === 'not_locked') {
      throw new BadRequestException('Could not cash out — please try again');
    }

    return result;
  }

  /**
   * Marks all active bets in a round as LOST.
   * Called within an existing DB transaction during round crash settlement.
   */
  async settleAllBets(roundId: string, manager: EntityManager): Promise<void> {
    await this.gameBetRepo.settleActiveBetsAsLost(roundId, manager);
    this.logger.log('All active bets settled as LOST', { roundId });
  }

  findActiveByRoundAndUser(
    roundId: string,
    userId: string,
  ): Promise<GameBet | null> {
    return this.gameBetRepo.findActiveByRoundAndUser(roundId, userId);
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
