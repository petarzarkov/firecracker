import { Module } from '@dunx/core';
import { ChatModule } from '../chat/chat.module.js';
import { GameBotsService } from './bots/game-bots.service.js';
import { CrashEngineService } from './engine/crash-engine.service.js';
import { GameController } from './game.controller.js';
import { GameGateway } from './game.gateway.js';
import { GameJobs } from './handlers/game.jobs.js';
import { GameBetRepository } from './repos/game-bet.repository.js';
import { GameRoundRepository } from './repos/game-round.repository.js';
import { WalletRepository } from './repos/wallet.repository.js';
import { AutoCashOutService } from './services/auto-cashout.service.js';
import { GameBetService } from './services/game-bet.service.js';
import { GameStateService } from './services/game-state.service.js';
import { GameRoundWatchdog } from './services/game-watchdog.service.js';
import { PlayerChatService } from './services/player-chat.service.js';
import { GameRoundService } from './services/game-round.service.js';
import { WalletService } from './services/wallet.service.js';
import { WalletController } from './wallet.controller.js';

/**
 * The crash game.
 *
 * **Decorated, and it used to be configured.** `forRoot({ engine, controllers })` had
 * exactly one caller - `WorkerModule`, which left the clock and the gateway out so a
 * second process could own the database transitions. There is no second process, and
 * the sandboxed child does not build this module at all. Dropping the factory also
 * removes the hazard it created: `forRoot()` returns a fresh object per call and a
 * scope is keyed on the module reference, so two callers meant two engines - which is
 * what `engine: false` was guarding against.
 *
 * `ChatModule` because the gateway carries the lobby chat, and that is the whole list.
 * The socket upgrade resolves a session, but `AccountsModule` is `global: true` and
 * naming it here bought nothing. No `NotificationsModule` either: both reach
 * `EventsPublisher` through the `global: true` `EventsPublisherModule`, and importing
 * it would call its `forRoot()` again and bind a second publisher.
 */
@Module({
  imports: [ChatModule],
  controllers: [GameController, WalletController],
  providers: [
    GameRoundRepository,
    GameBetRepository,
    WalletRepository,
    WalletService,
    // `GameBetService` and `GameRoundService` reference each other - the round
    // service settles bets, the bet service names the round service's
    // `RefundedBet`. In Nest this needed `forwardRef()` on both sides. dunx
    // records a dependency as a thunk evaluated at resolution rather than at
    // class-definition time, so the cycle resolves on its own and there is
    // nothing to annotate.
    GameBetService,
    GameRoundService,
    GameJobs,
    CrashEngineService,
    AutoCashOutService,
    GameStateService,
    PlayerChatService,
    GameGateway,
    GameBotsService,
    GameRoundWatchdog,
  ],
  exports: [GameRoundService, GameBetService, WalletService],
})
export class GameModule {}
