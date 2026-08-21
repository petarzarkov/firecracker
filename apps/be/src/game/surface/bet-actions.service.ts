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
  type CashOutAckPayload,
} from '../game.events.js';
import { GameMath } from '../game.math.js';
import { GameMessages } from './game.messages.js';
import { GameRoundStatus } from '../rounds/game-round.schema.js';
import { AutoCashOutService } from '../betting/auto-cashout.service.js';
import { GameBetService } from '../betting/game-bet.service.js';
import type { SocketPlayer } from './socket-auth.service.js';

/**
 * What placing a bet and cashing out actually mean.
 *
 * The phase gate, the debit, the entropy contribution, the auto-cashout registration
 * and the two frames each publishes. Not the gateway's, because money that only a
 * browser can exercise is money nobody checks: every case in
 * `bet-actions.service.test.ts` is a bug that shipped once.
 *
 * Every path returns an **ack**, never a throw. A socket handler has no error
 * mapper behind it, so a refusal that throws reaches the player as nothing at all.
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
   * **Synchronous, and that is the point.** `currentMultiplierX100` is a read of
   * the engine's clock, and it is taken once, at entry, before anything else can
   * happen. Re-reading it after a write - or making this `async` and reading it
   * after the first `await` - would pay whatever the curve had climbed to in the
   * meantime rather than what the player saw when they clicked.
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
     * Which wallet, decided by the **bet**, not by the client.
     *
     * `BetPanel` sends a bare `socket.emit('cashOut')` with no payload, so
     * defaulting to real money here meant looking for a bet that did not exist
     * and rejecting every demo cash-out - silently, because a rejection is an ack
     * rather than an error. That shipped, and only a browser caught it.
     *
     * Reading the bet row also survives a reconnect, cannot drift from the database,
     * and is right when a player holds bets in both modes - none of which a flag on
     * the socket manages.
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
