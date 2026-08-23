import {
  type ActiveBetView,
  type BetAckPayload,
  type BetCashedOutPayload,
  type BetPlacedPayload,
  type CashOutAckPayload,
  GAME_EVENTS,
  type GameCrashedPayload,
  type GamePhase as WirePhase,
  type GamePhasePayload,
  type GameRoundStatePayload,
  type GameTickPayload,
  type WalletUpdatedPayload,
} from '@firecracker/contracts';
import { startTransition, useEffect } from 'react';
import { useSocket } from '@/SocketContext';
import { useAuthStore } from '@/store/authStore';
import {
  type BetEntry,
  type GamePhase,
  liveRef,
  useGameStore,
} from '@/store/gameStore';

/**
 * The wire's phase, mapped to the store's.
 *
 * A `Record` rather than `.toUpperCase() as GamePhase`, which is what this did:
 * the cast asserted the two vocabularies matched, and they did not. The server has
 * a `failed` phase - a round that errored and refunded - and uppercasing it
 * produced `'FAILED'`, a value nothing in the store or the UI has a branch for.
 * Written this way, adding a phase server-side is a compile error here.
 *
 * `failed` maps to `IDLE`, not `CRASHED`: nothing is running, and drawing a crash
 * that never happened would be a lie about a round the player was refunded for.
 */
const CLIENT_PHASE: Record<WirePhase, GamePhase> = {
  waiting: 'WAITING',
  running: 'RUNNING',
  crashed: 'CRASHED',
  failed: 'IDLE',
};

/**
 * A server bet, as the store holds it.
 *
 * `userId` is the server's id. It used to be the **username** here, with a comment
 * claiming the server did not send one - true when it was written, false since
 * `ActiveBetView` gained the field. The result was that the snapshot sent on
 * connect keyed every row on a name while every later frame keyed on an id, so a
 * player who reloaded mid-round got a second row for their own bet and no
 * cash-out. Sharing the type is what surfaced it.
 */
export function mapServerBet(bet: ActiveBetView): BetEntry {
  return {
    userId: bet.userId,
    username: bet.username,
    betAmountCents: bet.betAmountCents,
    status: bet.cashedOutAt != null ? 'CASHED_OUT' : 'ACTIVE',
    cashedOutAt: bet.cashedOutAt,
    payoutCents: bet.payoutCents,
  };
}

export function useGameSocket() {
  const socket = useSocket();
  /**
   * The caller's real id.
   *
   * This used to be the username, matching the gateway's broadcast formula,
   * because the server sent no `userId` on a bet. It does now - so identity is an
   * id on both sides, and two players sharing a display name no longer collapse
   * into one row. `BetPanel`'s optimistic entry uses the same value, which is what
   * lets the server's `betPlaced` replace it instead of appearing beside it.
   */
  const myUserId = useAuthStore((state) => state.user?.id);
  const {
    setRoundState,
    setPhase,
    addTick,
    setCrashed,
    addBet,
    updateBet,
    setWalletBalance,
    setDemoBalance,
    setBetError,
    rollbackBet,
    rollbackCashOut,
  } = useGameStore();

  useEffect(() => {
    if (!socket) return;

    // Initial state sync on connect — deferred, large payload
    socket.on(GAME_EVENTS.ROUND_STATE, (data: GameRoundStatePayload) => {
      startTransition(() => {
        setRoundState(
          {
            roundId: data.roundId,
            phase: CLIENT_PHASE[data.phase],
            multiplier: data.multiplier ?? 1.0,
            elapsed: data.elapsed ?? 0,
            activeBets: data.activeBets.map(mapServerBet),
            waitingEndsAt: data.waitingEndsAt
              ? new Date(data.waitingEndsAt)
              : undefined,
            recentCrashes: data.recentCrashes?.map((r) => ({
              roundId: r.roundId,
              crashPoint: r.crashPoint,
            })),
          },
          myUserId,
        );
      });
    });

    // Phase changes are urgent — drive chart/button state immediately
    socket.on(GAME_EVENTS.PHASE_CHANGE, (data: GamePhasePayload) => {
      setPhase({
        roundId: data.roundId,
        phase: CLIENT_PHASE[data.phase],
        waitingEndsAt: data.waitingEndsAt
          ? new Date(data.waitingEndsAt)
          : undefined,
      });
    });

    // Ticks only mutate liveRef — no React state, always immediate
    socket.on(GAME_EVENTS.TICK, (data: GameTickPayload) => {
      addTick(data.multiplier, data.elapsed);
    });

    // Crash is urgent — updates phase + marks losing bets
    socket.on(GAME_EVENTS.CRASHED, (data: GameCrashedPayload) => {
      setCrashed(data.roundId, data.crashPoint);
    });

    // Player list updates — deferred so they don't block RAF/setInterval
    socket.on(GAME_EVENTS.BET_PLACED, (data: BetPlacedPayload) => {
      // Queued before the store work, and outside the transition, for the same
      // reason a cash-out is: the chart flies the player up to the rocket on the
      // frame the news arrived rather than after React has caught up.
      liveRef.boardings.push({
        name: data.username,
        betAmountCents: data.betAmountCents,
      });
      startTransition(() => {
        addBet(
          {
            userId: data.userId,
            username: data.username,
            betAmountCents: data.betAmountCents,
            status: 'ACTIVE',
          },
          myUserId,
        );
      });
    });

    socket.on(GAME_EVENTS.BET_CASHED_OUT, (data: BetCashedOutPayload) => {
      // Queued before the store work, so the chart draws the jump on the frame
      // the news arrived rather than after React has caught up.
      liveRef.cashOuts.push({
        name: data.username,
        multiplier: data.multiplier,
        payoutCents: data.payoutCents,
      });
      startTransition(() => {
        /**
         * Keyed on the id, not the username.
         *
         * This is what makes an **auto**-cashout visible: the whole point of one
         * is that the player is not watching, so the only way the panel learns the
         * bet is closed is this frame. Matched by username it matched nothing,
         * `myBet` never flipped, and the button went on offering a cash-out that
         * had already happened until the round ended.
         */
        const existing = useGameStore
          .getState()
          .activeBets.find((b) => b.userId === data.userId);
        updateBet(
          {
            userId: data.userId,
            username: data.username,
            betAmountCents: existing?.betAmountCents ?? 0,
            status: 'CASHED_OUT',
            cashedOutAt: data.multiplier,
            payoutCents: data.payoutCents,
          },
          myUserId,
        );
      });
    });

    socket.on(GAME_EVENTS.BET_ACK, (data: BetAckPayload) => {
      if (
        data.success &&
        data.userId &&
        data.username &&
        data.betAmountCents != null
      ) {
        /**
         * Confirm the optimistic entry with the server's own values - normally a
         * no-op, because `addBet` dedups on `userId`.
         *
         * It keyed this on the **username** until the server started sending an
         * id, which meant the confirmation did not match the optimistic row or
         * the `betPlaced` broadcast, and one bet rendered as two players.
         */
        const { userId, username, betAmountCents } = data;
        startTransition(() => {
          addBet(
            { userId, username, betAmountCents, status: 'ACTIVE' },
            userId,
          );
        });
      } else if (!data.success && data.error) {
        rollbackBet(); // remove the optimistic bet entry
        setBetError(data.error); // urgent — user needs immediate error feedback
      }
    });

    socket.on(GAME_EVENTS.CASH_OUT_ACK, (data: CashOutAckPayload) => {
      if (!data.success) {
        rollbackCashOut(); // undo optimistic cashout; phase-aware (LOST if crashed)
      }
    });

    // Balance update is low-priority display info
    socket.on(GAME_EVENTS.WALLET_UPDATED, (data: WalletUpdatedPayload) => {
      startTransition(() => {
        const { isDemoMode } = useGameStore.getState();
        if (isDemoMode) {
          setDemoBalance(data.balanceCents);
        } else {
          setWalletBalance(data.balanceCents);
        }
      });
    });

    return () => {
      for (const event of Object.values(GAME_EVENTS)) socket.off(event);
    };
  }, [
    socket,
    myUserId,
    setRoundState,
    setPhase,
    addTick,
    setCrashed,
    addBet,
    updateBet,
    setWalletBalance,
    setDemoBalance,
    setBetError,
    rollbackBet,
    rollbackCashOut,
  ]);
}
