import { Module } from '@dunx/core';
import { ChatModule } from '../chat/chat.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { GameBotsService } from './bots/game-bots.service.js';
import { CrashEngineService } from './engine/crash-engine.service.js';
import { ClientSeedService } from './fairness/client-seed.service.js';
import { GameController } from './game.controller.js';
import { GameGateway } from './game.gateway.js';
import { GameJobs } from './handlers/game.jobs.js';
import { GameBetRepository } from './repos/game-bet.repository.js';
import { GameRoundRepository } from './repos/game-round.repository.js';
import { AutoCashOutService } from './services/auto-cashout.service.js';
import { GameBetService } from './services/game-bet.service.js';
import { GameStateService } from './services/game-state.service.js';
import { GameRoundWatchdog } from './services/game-watchdog.service.js';
import { PlayerChatService } from './services/player-chat.service.js';
import { GameRoundService } from './services/game-round.service.js';

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
 * Nothing here is exported. `AppModule` is its only importer and declares no
 * provider that injects into the game, so an `exports` list was a public surface
 * with no public.
 *
 * `ChatModule` because the gateway carries the lobby chat, and `WalletModule` because
 * a bet moves money - and that is the whole list. `WalletModule` exports only
 * `WalletService`, so the game can spend a balance and cannot write one: see that
 * class's doc comment for the seam. The socket upgrade resolves a session, but
 * `AccountsModule` is `global: true` and naming it here bought nothing. No `NotificationsModule` either: both reach
 * `EventsPublisher` through the `global: true` `EventsPublisherModule`, and importing
 * it would call its `forRoot()` again and bind a second publisher.
 */
@Module({
  imports: [ChatModule, WalletModule],
  controllers: [GameController],
  providers: [
    ClientSeedService,
    GameRoundRepository,
    GameBetRepository,
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
})
export class GameModule {}
