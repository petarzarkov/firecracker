import type { ServerPayloads } from '@firecracker/contracts';
import { ChatService } from '../../chat/services/chat.service.js';
import { WalletService } from '../../wallet/services/wallet.service.js';
import { EVENTS } from '../../notifications/events/events.js';
import { CrashEngineService } from '../engine/crash-engine.service.js';
import { GAME_EVENTS, type GameRoundStatePayload } from '../game.events.js';
import type { SocketPlayer } from './socket-auth.service.js';
import { GameMath } from '../game.math.js';
import { GameRoundStatus } from '../rounds/game-round.schema.js';
import { GameView } from './game.view.js';
import { GameBetService } from '../betting/game-bet.service.js';
import { GameRoundService } from '../rounds/game-round.service.js';

/**
 * One frame, with its payload checked against its name - a mapped type rather than
 * `{ event: string; data: unknown }`, because a name and a shape travel together.
 */
export type SocketFrame = {
  [E in keyof ServerPayloads]: {
    readonly event: E;
    readonly data: ServerPayloads[E];
  };
}[keyof ServerPayloads];

/**
 * The lobby's read model: the engine's in-memory clock composed with the database's
 * round and bets. A projection, not transport - subscription is per-connection and
 * stays in the gateway.
 */
export class GameStateService {
  constructor(
    private readonly engine: CrashEngineService,
    private readonly rounds: GameRoundService,
    private readonly bets: GameBetService,
    private readonly wallets: WalletService,
    private readonly chat: ChatService,
  ) {}

  /**
   * Everything a client is sent on connect, in order. Published to nobody: this is
   * its own view of the round, its own identity and its own balance.
   */
  async connectFrames(
    player: SocketPlayer | null,
  ): Promise<readonly SocketFrame[]> {
    const frames: SocketFrame[] = [
      { event: GAME_EVENTS.ROUND_STATE, data: this.snapshot() },
      // A player who reloads mid-round should not find an empty chat window.
      { event: EVENTS.CHAT_HISTORY, data: await this.chat.history() },
    ];

    if (player === null) return frames;

    return [
      ...frames,
      // `{ payload }` is the envelope the client's `updateUser` destructures.
      {
        event: EVENTS.CONNECTED,
        data: {
          payload: {
            id: player.userId,
            email: player.email,
            displayName: player.username,
            picture: player.picture,
          },
        },
      },
      // The demo wallet, created on first sight, so a new player has something to
      // bet with before they have done anything.
      {
        event: GAME_EVENTS.WALLET_UPDATED,
        data: {
          balanceCents: this.wallets.getWallet(player.userId, true)
            .balanceCents,
          isDemo: true,
        },
      },
    ];
  }

  snapshot(): GameRoundStatePayload {
    const round = this.rounds.getCurrentRound();
    const phase = this.engine.phase ?? GameRoundStatus.WAITING;
    const multiplierX100 = this.engine.currentMultiplierX100();

    return {
      phase,
      roundId: round?.id ?? null,
      seedHash: round?.seedHash ?? null,
      // Spread rather than assigned: the payload declares an absent key, which
      // `exactOptionalPropertyTypes` separates from an explicit `undefined`.
      ...(round === undefined ? {} : { nonce: round.nonce }),
      recentCrashes: GameView.recentCrashes(this.rounds.getRecentCrashes(15)),
      activeBets:
        round === undefined
          ? []
          : this.bets.findByRoundWithPlayers(round.id).map(GameView.activeBet),
      ...(multiplierX100 === null
        ? {}
        : {
            multiplier: GameMath.toMultiplier(multiplierX100),
            elapsed:
              round?.startedAt == null
                ? 0
                : Date.now() - round.startedAt.getTime(),
          }),
      ...(phase === GameRoundStatus.WAITING && round?.waitingEndsAt != null
        ? { waitingEndsAt: round.waitingEndsAt.toISOString() }
        : {}),
    };
  }
}
