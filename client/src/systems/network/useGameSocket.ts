import { useEffect } from 'react';
import { useSocket } from '@/SocketContext';
import { useAuthStore } from '@/store/authStore';
import { type BetEntry, type GamePhase, useGameStore } from '@/store/gameStore';

interface BetSummary {
  userId: string;
  username: string;
  betAmountCents: number;
  status: 'ACTIVE' | 'CASHED_OUT' | 'LOST';
  cashedOutAt?: number;
  payoutCents?: number;
}

interface GameRoundStatePayload {
  roundId: string | null;
  phase: GamePhase;
  multiplier: number;
  elapsed: number;
  activeBets: BetSummary[];
  waitingEndsAt?: string;
  startedAt?: string;
}

interface GamePhasePayload {
  roundId: string;
  phase: 'WAITING' | 'RUNNING' | 'CRASHED';
  waitingEndsAt?: string;
  startedAt?: string;
  crashedAt?: string;
}

interface GameCrashedPayload {
  roundId: string;
  crashPoint: number;
  seed: string;
  elapsed: number;
}

interface BetEventPayload {
  roundId: string;
  bet: BetSummary;
}

interface BetAckPayload {
  success: boolean;
  bet?: BetSummary;
  error?: string;
}

interface CashOutAckPayload {
  success: boolean;
  cashedOutAt?: number;
  payoutCents?: number;
  error?: string;
}

function mapBet(b: BetSummary): BetEntry {
  return {
    userId: b.userId,
    username: b.username,
    betAmountCents: b.betAmountCents,
    status: b.status,
    cashedOutAt: b.cashedOutAt,
    payoutCents: b.payoutCents,
  };
}

export function useGameSocket() {
  const socket = useSocket();
  const userId = useAuthStore(state => state.user?.id);
  const {
    setRoundState,
    setPhase,
    addTick,
    setCrashed,
    addBet,
    updateBet,
    setMyBet,
    setWalletBalance,
  } = useGameStore();

  useEffect(() => {
    if (!socket) return;

    socket.on('gameRoundState', (data: GameRoundStatePayload) => {
      setRoundState(
        {
          ...data,
          activeBets: data.activeBets.map(mapBet),
          waitingEndsAt: data.waitingEndsAt
            ? new Date(data.waitingEndsAt)
            : undefined,
          startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
        },
        userId,
      );
    });

    socket.on('gamePhaseChange', (data: GamePhasePayload) => {
      setPhase({
        roundId: data.roundId,
        phase: data.phase,
        waitingEndsAt: data.waitingEndsAt
          ? new Date(data.waitingEndsAt)
          : undefined,
        startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
        crashedAt: data.crashedAt ? new Date(data.crashedAt) : undefined,
      });
    });

    socket.on('gameTick', (data: { multiplier: number; elapsed: number }) => {
      addTick(data.multiplier, data.elapsed);
    });

    socket.on('gameCrashed', (data: GameCrashedPayload) => {
      setCrashed(data.roundId, data.crashPoint);
    });

    socket.on('betPlaced', (data: BetEventPayload) => {
      addBet(mapBet(data.bet), userId);
    });

    socket.on('betCashedOut', (data: BetEventPayload) => {
      updateBet(mapBet(data.bet), userId);
    });

    socket.on('betAck', (data: BetAckPayload) => {
      if (data.success && data.bet) {
        setMyBet(mapBet(data.bet));
      }
    });

    socket.on('cashOutAck', (_data: CashOutAckPayload) => {
      // betCashedOut broadcast handles the state update
    });

    socket.on('walletUpdated', (data: { balanceCents: number }) => {
      setWalletBalance(data.balanceCents);
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
    userId,
    setRoundState,
    setPhase,
    addTick,
    setCrashed,
    addBet,
    updateBet,
    setMyBet,
    setWalletBalance,
  ]);
}
