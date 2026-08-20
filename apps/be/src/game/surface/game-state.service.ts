import type { ServerPayloads } from '@firecracker/contracts';
import { ChatService } from '../../chat/services/chat.service.js';
import { WalletService } from '../../wallet/services/wallet.service.js';
import { EVENTS } from '../../notifications/events/events.js';
import { CrashEngineService } from '../engine/crash-engine.service.js';
import { GAME_EVENTS, type GameRoundStatePayload } from '../game.events.js';
import type { SocketPlayer } from './socket-auth.service.js';
import { GameMath } from '../game.math.js';
import { GameRoundStatus } from '../schema/game-round.schema.js';
import { GameView } from './game.view.js';
import { GameBetService } from '../betting/game-bet.service.js';
import { GameRoundService } from '../rounds/game-round.service.js';

/**
 * One frame, with its payload checked against its name.
 *
 * A mapped type rather than `{ event: string; data: unknown }`, because the whole
 * point of `@firecracker/contracts` is that a name and a shape travel together -
 * and the four frames below are the ones a client sees before it has sent anything.
 */
export type SocketFrame = {
  [E in keyof ServerPayloads]: {
    readonly event: E;
    readonly data: ServerPayloads[E];
  };
}[keyof ServerPayloads];

/**
 * The lobby's read model: one object describing the whole game as it stands, and
 * the frames a socket is owed the moment it opens.
 *
 * Split out of `GameGateway` because it is a projection rather than transport - it
 * composes the engine's in-memory clock with the database's round and bets, and
 * nothing about it needs a socket. What it does *not* own is subscription: that is
 * per-connection, so the `socket.subscribe` calls stay in the gateway.
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
   * Everything a client is sent on connect, in order, and addressed to it alone.
   *
   * Published to nobody: this is one client's own view of the round, its own
   * scrollback, its own identity and its own balance. It was four `socket.send`
   * calls in `@OnOpen` with the payloads built inline; as a list it is testable and
   * the gateway's handler is a loop.
   */
  async connectFrames(
    player: SocketPlayer | null,
  ): Promise<readonly SocketFrame[]> {
    const frames: SocketFrame[] = [
      { event: GAME_EVENTS.ROUND_STATE, data: this.snapshot() },
      // A player who reloads mid-round should not find an empty chat window - see
      // `ChatService`, which keeps this in Redis rather than in the database the
      // bet path is writing to.
      { event: EVENTS.CHAT_HISTORY, data: await this.chat.history() },
    ];

    if (player === null) return frames;

    return [
      ...frames,
      // `{ payload }` because that is the envelope the client's `updateUser`
      // already destructures. The wire shape is the client's to dictate; there is
      // no reason to rename it here and edit React for the privilege.
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
      // Spread rather than assigned: `exactOptionalPropertyTypes` separates an
      // absent key from an explicit `undefined`, and the payload declares the
      // former.
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
