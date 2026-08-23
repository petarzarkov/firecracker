import { EventsPublisher } from '../../notifications/events/events.publisher.js';
import { Topics } from '../../notifications/events/events.js';
import { WalletService } from '../../wallet/services/wallet.service.js';
import { CrashEngineService } from '../engine/crash-engine.service.js';
import { ClientSeedService } from '../fairness/client-seed.service.js';
import {
  GAME_EVENTS,
  GAME_TOPIC,
  publishGame,
  type BetAckPayload,
  type CancelBetAckPayload,
  type CashOutAckPayload,
} from '../game.events.js';
import { GameMath } from '../game.math.js';
import { GameMessages } from './game.messages.js';
import { GameRoundStatus } from '../rounds/game-round.schema.js';
import { AutoCashOutService } from '../betting/auto-cashout.service.js';
import { GameBetService } from '../betting/game-bet.service.js';
import type { SocketPlayer } from './socket-auth.service.js';

/**
 * What placing a bet and cashing out actually mean. Not the gateway's, because money
 * only a browser can exercise is money nobody checks - every case in
 * `bet-actions.service.test.ts` is a bug that shipped once.
 *
 * Every path returns an **ack**, never a throw: a socket handler has no error mapper
 * behind it, so a refusal that throws reaches the player as nothing at all.
 */
export class BetActionsService {
  constructor(
    private readonly engine: CrashEngineService,
    private readonly bets: GameBetService,
    private readonly wallets: WalletService,
    private readonly autoCashOut: AutoCashOutService,
    private readonly clientSeeds: ClientSeedService,
    private readonly events: EventsPublisher,
  ) {}

  async place(
    player: SocketPlayer | null,
    data: unknown,
  ): Promise<BetAckPayload> {
    if (player === null) {
      return { success: false, error: 'Login required to place bets' };
    }

    const parsed = GameMessages.parseBet(data);
    if (parsed === null) {
      return { success: false, error: 'Invalid bet' };
    }

    if (this.engine.phase !== GameRoundStatus.WAITING) {
      return {
        success: false,
        error: 'Bets are only accepted during the waiting phase',
      };
    }

    const roundId = this.engine.roundId;
    if (roundId === null) {
      return { success: false, error: 'No active round' };
    }

    const { betAmountCents, isDemo, autoCashOutAt } = parsed;

    try {
      const bet = this.bets.placeBet(
        player.userId,
        roundId,
        betAmountCents,
        isDemo,
      );

      // Entropy on the player's behalf. After the debit, so a refused bet does not
      // contribute to the pool the crash point is drawn from.
      await this.clientSeeds.contributeIfAbsent(roundId, player.userId);

      if (autoCashOutAt !== undefined) {
        await this.autoCashOut.store(
          roundId,
          player.userId,
          player.username,
          autoCashOutAt,
          isDemo,
        );
      }

      const wallet = this.wallets.getWallet(player.userId, isDemo);
      publishGame(
        this.events,
        Topics.user(player.userId),
        GAME_EVENTS.WALLET_UPDATED,
        { balanceCents: wallet.balanceCents, isDemo },
      );
      publishGame(this.events, GAME_TOPIC, GAME_EVENTS.BET_PLACED, {
        userId: player.userId,
        username: player.username,
        betAmountCents: bet.betAmountCents,
        isDemo,
      });

      return {
        success: true,
        userId: player.userId,
        username: player.username,
        betAmountCents: bet.betAmountCents,
      };
    } catch (error) {
      return {
        success: false,
        error: GameMessages.playerFacing(error, 'Failed to place bet'),
      };
    }
  }

  /**
   * Taking a bet back, which is only a thing during the betting window.
   *
   * Guarded on the phase for the obvious reason: once the rocket is climbing, the
   * exit is a cash-out at the multiplier, and a "cancel" would be a refund of a bet
   * that is already losing. The auto-cashout goes with it - a target for a bet that
   * no longer exists would pay out on a round the player is not in.
   */
  async cancel(player: SocketPlayer | null): Promise<CancelBetAckPayload> {
    if (player === null) {
      return { success: false, error: 'Login required' };
    }

    if (this.engine.phase !== GameRoundStatus.WAITING) {
      return {
        success: false,
        error: 'A bet can only be cancelled before the round starts',
      };
    }

    const roundId = this.engine.roundId;
    if (roundId === null) {
      return { success: false, error: 'No active round' };
    }

    try {
      const cancelled = this.bets.cancelBet(player.userId, roundId);
      await this.autoCashOut.clear(roundId, player.userId);

      publishGame(
        this.events,
        Topics.user(player.userId),
        GAME_EVENTS.WALLET_UPDATED,
        { balanceCents: cancelled.balanceCents, isDemo: cancelled.isDemo },
      );
      publishGame(this.events, GAME_TOPIC, GAME_EVENTS.BET_CANCELLED, {
        userId: player.userId,
      });

      return { success: true, refundedCents: cancelled.refundedCents };
    } catch (error) {
      return {
        success: false,
        error: GameMessages.playerFacing(error, 'Failed to cancel the bet'),
      };
    }
  }

  /**
   * **Synchronous, and that is the point.** The engine's clock is read once, at
   * entry: re-reading after a write - or making this `async` - pays whatever the
   * curve climbed to since, rather than what the player saw when they clicked.
   */
  cashOut(player: SocketPlayer | null, data: unknown): CashOutAckPayload {
    if (player === null) {
      return { success: false, error: 'Login required to cash out' };
    }

    const roundId = this.engine.roundId;
    if (roundId === null) {
      return { success: false, error: 'No active round' };
    }

    const multiplierX100 =
      this.engine.currentMultiplierX100() ?? this.engine.graceMultiplierX100();
    if (multiplierX100 === null) {
      return { success: false, error: 'Round is not currently running' };
    }

    /**
     * Which wallet, decided by the **bet**, not by the client. `BetPanel` sends
     * `cashOut` with no payload, so defaulting to real money rejected every demo
     * cash-out - silently, because a rejection is an ack. Reading the row also
     * survives a reconnect and is right when a player holds bets in both modes.
     */
    const requested =
      typeof data === 'object' && data !== null && 'isDemo' in data
        ? Boolean((data as { isDemo?: unknown }).isDemo)
        : undefined;

    const open = this.bets.findActiveByRoundAndUserAnyMode(
      roundId,
      player.userId,
    );
    if (open === undefined) {
      return { success: false, error: 'No active bet found for this round' };
    }
    const isDemo = requested ?? open.isDemo;

    try {
      const bet = this.bets.cashOut(
        player.userId,
        roundId,
        multiplierX100,
        isDemo,
      );
      const wallet = this.wallets.getWallet(player.userId, isDemo);
      const multiplier = GameMath.toMultiplier(multiplierX100);

      publishGame(
        this.events,
        Topics.user(player.userId),
        GAME_EVENTS.WALLET_UPDATED,
        { balanceCents: wallet.balanceCents, isDemo },
      );
      publishGame(this.events, GAME_TOPIC, GAME_EVENTS.BET_CASHED_OUT, {
        userId: player.userId,
        username: player.username,
        multiplier,
        payoutCents: bet.payoutCents ?? 0,
        isDemo,
      });

      return {
        success: true,
        multiplier,
        payoutCents: bet.payoutCents ?? 0,
      };
    } catch (error) {
      return {
        success: false,
        error: GameMessages.playerFacing(error, 'Failed to cash out'),
      };
    }
  }
}
