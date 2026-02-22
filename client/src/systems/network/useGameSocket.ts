import { useEffect } from 'react';
import { useSocket } from '@/SocketContext';
import { useAuthStore } from '@/store/authStore';
import { type BetEntry, type GamePhase, useGameStore } from '@/store/gameStore';

// ── Server payload shapes (matching src/notifications/events/events.dto.ts) ──

interface ServerBetSummary {
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
    state => state.user?.displayName ?? state.user?.email?.split('@')[0],
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
  } = useGameStore();

  useEffect(() => {
    if (!socket) return;

    socket.on('gameRoundState', (data: ServerGameRoundStatePayload) => {
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
          recentCrashes: data.recentCrashes?.map(r => ({
            roundId: r.roundId,
            crashPoint: r.crashPoint,
          })),
        },
        myUsername,
      );
    });

    socket.on('gamePhaseChange', (data: ServerGamePhasePayload) => {
      setPhase({
        roundId: data.roundId,
        phase: data.phase.toUpperCase() as GamePhase,
        waitingEndsAt: data.waitingEndsAt
          ? new Date(data.waitingEndsAt)
          : undefined,
      });
    });

    socket.on('gameTick', (data: { multiplier: number; elapsed: number }) => {
      addTick(data.multiplier, data.elapsed);
    });

    socket.on('gameCrashed', (data: ServerGameCrashedPayload) => {
      setCrashed(data.roundId, data.crashPoint);
    });

    socket.on('betPlaced', (data: ServerBetPlacedPayload) => {
      addBet(
        {
          userId: data.username,
          username: data.username,
          betAmountCents: data.betAmountCents,
          status: 'ACTIVE',
        },
        myUsername,
      );
    });

    socket.on('betCashedOut', (data: ServerBetCashedOutPayload) => {
      // Preserve the original betAmountCents from the live store
      const existing = useGameStore
        .getState()
        .activeBets.find(b => b.userId === data.username);
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

    socket.on('betAck', (data: BetAckPayload) => {
      if (data.success && data.username && data.betAmountCents != null) {
        // Server confirmed the bet — set myBet directly without username matching
        addBet(
          {
            userId: data.username,
            username: data.username,
            betAmountCents: data.betAmountCents,
            status: 'ACTIVE',
          },
          data.username,
        );
      } else if (!data.success && data.error) {
        setBetError(data.error);
      }
    });

    socket.on('cashOutAck', (_data: CashOutAckPayload) => {
      // betCashedOut broadcast handles the state update
    });

    socket.on('walletUpdated', (data: { balanceCents: number }) => {
      const { isDemoMode } = useGameStore.getState();
      if (isDemoMode) {
        setDemoBalance(data.balanceCents);
      } else {
        setWalletBalance(data.balanceCents);
      }
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
  ]);
}
