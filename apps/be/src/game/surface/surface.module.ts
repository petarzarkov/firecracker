import { Module } from '@dunx/core';
import { ChatModule } from '../../chat/chat.module.js';
import { WalletModule } from '../../wallet/wallet.module.js';
import { GameBettingModule } from '../betting/betting.module.js';
import { GameEngineModule } from '../engine/engine.module.js';
import { GameFairnessModule } from '../fairness/fairness.module.js';
import { GameRoundsModule } from '../rounds/rounds.module.js';
import { BetActionsService } from './bet-actions.service.js';
import { GameController } from './game.controller.js';
import { GameGateway } from './game.gateway.js';
import { GameStateService } from './game-state.service.js';
import { PlayerChatService } from './player-chat.service.js';
import { SocketAuthService } from './socket-auth.service.js';

/**
 * Presentation: the one socket, the HTTP routes, and the projections behind both.
 *
 * HTTP and WebSocket in one module rather than two, and that is deliberate: a
 * controller action and an `@OnMessage` handler do the same three things - validate,
 * call a service, answer - and a separate `http` module could not import this one
 * without dragging the gateway in, so it would restate five imports to own one
 * controller.
 *
 * This is the only module that imports all four of the others, which is what makes
 * it the presentation layer rather than another feature: everything below it is
 * reachable from here and nothing here is reachable from below.
 *
 * Nothing is exported. A gateway is mounted, not injected.
 */
@Module({
  imports: [
    GameEngineModule,
    GameRoundsModule,
    GameBettingModule,
    GameFairnessModule,
    ChatModule,
    WalletModule,
  ],
  controllers: [GameController],
  providers: [
    SocketAuthService,
    BetActionsService,
    GameStateService,
    PlayerChatService,
    GameGateway,
  ],
})
export class GameSurfaceModule {}
