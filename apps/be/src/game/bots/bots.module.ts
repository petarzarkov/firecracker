import { Module } from '@dunx/core';
import { ChatModule } from '../../chat/chat.module.js';
import { GameEngineModule } from '../engine/engine.module.js';
import { GameBotsService } from './game-bots.service.js';

/**
 * Cosmetic lobby activity, and the scope is the enforcement.
 *
 * A bot must never touch the database, a wallet, the ledger or the client-seed pool -
 * see `GameBotsService` for what that would cost. The scope is what enforces it:
 * `GameEngineModule` exports `CrashEngineService` and nothing else and `ChatModule`
 * exports `ChatService`, so `GameBetService`, `GameBetRepository`, `WalletService` and
 * `ClientSeedService` are **not visible here at all**. A constructor that named one
 * fails at boot rather than compiling and quietly placing a bet.
 *
 * Nothing is exported: nothing injects a bot.
 */
@Module({
  imports: [GameEngineModule, ChatModule],
  providers: [GameBotsService],
})
export class GameBotsModule {}
