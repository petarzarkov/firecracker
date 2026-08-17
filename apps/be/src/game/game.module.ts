import type { DynamicModule } from '@dunx/core';
import { AccountsModule } from '../auth/auth.module.js';
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
import { PlayerChatService } from './services/player-chat.service.js';
import { GameRoundService } from './services/game-round.service.js';
import { WalletService } from './services/wallet.service.js';
import { WalletController } from './wallet.controller.js';

export interface GameModuleOptions {
  /**
   * The tick loop and the socket gateway. **`false` in the worker.**
   *
   * This is the single most load-bearing flag in the app. The engine holds the
   * clock: it decides when the multiplier reaches the crash point and enqueues the
   * job that settles the round. Two processes running it would each enqueue their
   * own crash and each broadcast their own ticks, and a client would watch the
   * multiplier stutter between two timelines.
   *
   * It also gates the gateway, for a duller reason: `WorkerFactory` builds a
   * container with no server in it, so there is nothing for a gateway to upgrade
   * on and `PubSub` is not bound.
   */
  readonly engine?: boolean;
  /** `false` in the worker, which serves no HTTP. */
  readonly controllers?: boolean;
}

/**
 * The crash game.
 *
 * ## What is here in both processes and what is not
 *
 * The repositories, the three services and `GameJobs` are built in **both** the web
 * process and the worker, because both need to read and write rounds - the worker
 * owns the transitions, and the web process needs the same services to answer a
 * bet on a socket.
 *
 * The engine and the gateway are web-only. See {@link GameModuleOptions.engine}.
 *
 * ## What it does not import
 *
 * No `NotificationsModule`. Both this module and that one publish socket events,
 * and both reach `EventsPublisher` through `EventsPublisherModule`, which is
 * `global: true` and built once by `foundation()`. Importing `NotificationsModule`
 * to get at the publisher would have called its `forRoot()` a second time and
 * produced a second scope with a second binding.
 *
 * `AccountsModule` **is** imported, and only when the gateway is: the upgrade
 * resolves a session through `Auth`. A class module is one reference however many
 * modules import it, so this costs nothing.
 */
export class GameModule {
  static forRoot(options: GameModuleOptions = {}): DynamicModule {
    const withEngine = options.engine !== false;
    const withControllers = options.controllers !== false;

    return {
      module: GameModule,
      // `ChatModule` alongside auth, and for the same reason: both are only
      // needed where there is a gateway to serve them.
      imports: withEngine ? [AccountsModule, ChatModule] : [],
      ...(withControllers
        ? { controllers: [GameController, WalletController] }
        : {}),
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
        // With the engine, because a bot watches its phase - and because a bot
        // publishing from the worker would double every frame.
        ...(withEngine
          ? [
              CrashEngineService,
              AutoCashOutService,
              GameStateService,
              PlayerChatService,
              GameGateway,
              GameBotsService,
            ]
          : []),
      ],
      exports: [GameRoundService, GameBetService, WalletService],
    };
  }
}
