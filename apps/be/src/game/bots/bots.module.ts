import { Module } from '@dunx/core';
import { ChatModule } from '../../chat/chat.module.js';
import { GameEngineModule } from '../engine/engine.module.js';
import { GameBotsService } from './game-bots.service.js';

/**
 * Cosmetic lobby activity, and the scope is the enforcement.
 *
 * `GameBotsService`'s doc comment has always said a bot never touches the database,
 * a wallet, the ledger or the client-seed pool - because a bot placing real bets
 * would contribute entropy to the crash point through the pool, which is the house
 * deciding some of the players' seeds. What kept that true was a paragraph.
 *
 * Now it is the graph. This module imports `GameEngineModule`, which exports
 * `CrashEngineService` and nothing else, and `ChatModule`, which exports
 * `ChatService`. `GameBetService`, `GameBetRepository`, `WalletService` and
 * `ClientSeedService` are **not visible in this scope at all** - a constructor here
 * that named one would fail at boot, with dunx naming the token and the import that
 * is missing, rather than compiling and quietly placing a bet.
 *
 * Nothing is exported: nothing injects a bot.
 */
@Module({
  imports: [GameEngineModule, ChatModule],
  providers: [GameBotsService],
})
export class GameBotsModule {}
