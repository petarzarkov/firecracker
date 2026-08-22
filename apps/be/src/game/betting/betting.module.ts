import { Module } from '@dunx/core';
import { WalletModule } from '../../wallet/wallet.module.js';
import { AutoCashOutService } from './auto-cashout.service.js';
import { GameBetRepository } from './game-bet.repository.js';
import { GameBetService } from './game-bet.service.js';

/**
 * The money: a stake, its settlement, and the promise to settle it automatically.
 *
 * `WalletModule` because a bet moves money, and it exports only `WalletService` -
 * so this module can spend a balance and cannot write one. See that class for the
 * seam: every method that moves money takes the caller's transaction handle and is
 * synchronous, which is what makes `GameBetService`'s read-check-write atomic.
 *
 * **This module must never import `GameRoundsModule`.** Rounds imports betting -
 * `settleCrash` and `failAndRefund` call in from inside their own transaction - and
 * reversing that edge would put the bet service in the round module's scope, which
 * is one import away from putting it in the bots'. dunx survives a module cycle,
 * so nothing would fail; the guarantee would just stop being true.
 */
@Module({
  imports: [WalletModule],
  providers: [GameBetRepository, GameBetService, AutoCashOutService],
  // Not the repository: `PlayerChatService` was the only thing outside this module
  // that ever needed it, for a display name, and it reads `PlayerDirectory` now.
  exports: [GameBetService, AutoCashOutService],
})
export class GameBettingModule {}
