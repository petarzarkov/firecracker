import { startTransition, useEffect } from 'react';
import { useSocket } from '@/SocketContext';
import { useAuthStore } from '@/store/authStore';
import { type BetEntry, type GamePhase, useGameStore } from '@/store/gameStore';

// ── Server payload shapes (matching src/notifications/events/events.dto.ts) ──

interface ServerBetSummary {
  userId: string;
  username: string;
  betAmountCents: number;
  isDemo: boolean;
  cashedOutAt?: number;
}

interface ServerCrashedRoundSummary {
  roundId: string;
  crashPoint: number;
}

interface ServerGameRoundStatePayload {
  roundId: string | null;
  phase: 'waiting' | 'running' | 'crashed';
  seedHash: string | null;
  multiplier?: number;
  elapsed?: number;
  activeBets: ServerBetSummary[];
  waitingEndsAt?: string;
  recentCrashes?: ServerCrashedRoundSummary[];
}

interface ServerGamePhasePayload {
  roundId: string;
  phase: 'waiting' | 'running' | 'crashed';
  seedHash: string;
  waitingEndsAt?: string;
}

interface ServerGameCrashedPayload {
  roundId: string;
  crashPoint: number;
  seed: string;
  crashedAt: string;
}

interface ServerBetPlacedPayload {
  userId: string;
  username: string;
  betAmountCents: number;
  isDemo: boolean;
}

interface ServerBetCashedOutPayload {
  userId: string;
  username: string;
  multiplier: number;
  payoutCents: number;
  isDemo: boolean;
}

interface BetAckPayload {
  success: boolean;
  error?: string;
  /** The caller's own id. See the note where this is consumed. */
  userId?: string;
  username?: string;
  betAmountCents?: number;
}

interface CashOutAckPayload {
  success: boolean;
  multiplier?: number;
  payoutCents?: number;
  error?: string;
}

/**
 * Map a server BetSummary to the client BetEntry shape.
 * The server doesn't expose userId — username is used as the dedup key.
 */
function mapServerBet(b: ServerBetSummary): BetEntry {
  return {
    userId: b.username,
    username: b.username,
    betAmountCents: b.betAmountCents,
    status: b.cashedOutAt != null ? 'CASHED_OUT' : 'ACTIVE',
    cashedOutAt: b.cashedOutAt,
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
    socket.on('gameRoundState', (data: ServerGameRoundStatePayload) => {
      startTransition(() => {
        setRoundState(
          {
            roundId: data.roundId,
            phase: data.phase.toUpperCase() as GamePhase,
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
    socket.on('gamePhaseChange', (data: ServerGamePhasePayload) => {
      setPhase({
        roundId: data.roundId,
        phase: data.phase.toUpperCase() as GamePhase,
        waitingEndsAt: data.waitingEndsAt
          ? new Date(data.waitingEndsAt)
          : undefined,
      });
    });

    // Ticks only mutate liveRef — no React state, always immediate
    socket.on('gameTick', (data: { multiplier: number; elapsed: number }) => {
      addTick(data.multiplier, data.elapsed);
    });

    // Crash is urgent — updates phase + marks losing bets
    socket.on('gameCrashed', (data: ServerGameCrashedPayload) => {
      setCrashed(data.roundId, data.crashPoint);
    });

    // Player list updates — deferred so they don't block RAF/setInterval
    socket.on('betPlaced', (data: ServerBetPlacedPayload) => {
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

    socket.on('betCashedOut', (data: ServerBetCashedOutPayload) => {
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

    socket.on('betAck', (data: BetAckPayload) => {
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

    socket.on('cashOutAck', (data: CashOutAckPayload) => {
      if (!data.success) {
        rollbackCashOut(); // undo optimistic cashout; phase-aware (LOST if crashed)
      }
    });

    // Balance update is low-priority display info
    socket.on('walletUpdated', (data: { balanceCents: number }) => {
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
      socket.off('gameRoundState');
      socket.off('gamePhaseChange');
      socket.off('gameTick');
      socket.off('gameCrashed');
      socket.off('betPlaced');
      socket.off('betCashedOut');
      socket.off('betAck');
      socket.off('cashOutAck');
      socket.off('walletUpdated');
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
