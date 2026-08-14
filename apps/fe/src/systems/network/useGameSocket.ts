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
  username: string;
  multiplier: number;
  payoutCents: number;
  isDemo: boolean;
}

interface BetAckPayload {
  success: boolean;
  error?: string;
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
  // Match the formula the gateway uses when broadcasting bet usernames:
  // user.displayName ?? user.email.split('@')[0]
  const myUsername = useAuthStore(
    (state) => state.user?.displayName ?? state.user?.email?.split('@')[0],
  );
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
          myUsername,
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
          myUsername,
        );
      });
    });

    socket.on('betCashedOut', (data: ServerBetCashedOutPayload) => {
      startTransition(() => {
        const existing = useGameStore
          .getState()
          .activeBets.find((b) => b.userId === data.username);
        updateBet(
          {
            userId: data.username,
            username: data.username,
            betAmountCents: existing?.betAmountCents ?? 0,
            status: 'CASHED_OUT',
            cashedOutAt: data.multiplier,
            payoutCents: data.payoutCents,
          },
          myUsername,
        );
      });
    });

    socket.on('betAck', (data: BetAckPayload) => {
      if (data.success && data.username && data.betAmountCents != null) {
        // Confirm the optimistic bet with server-provided values (typically a no-op)
        const username = data.username;
        const betAmountCents = data.betAmountCents;
        startTransition(() => {
          addBet(
            { userId: username, username, betAmountCents, status: 'ACTIVE' },
            username,
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
    myUsername,
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
