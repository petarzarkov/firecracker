import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type GamePhase = 'IDLE' | 'WAITING' | 'RUNNING' | 'CRASHED';

export interface BetEntry {
  userId: string;
  username: string;
  betAmountCents: number;
  status: 'ACTIVE' | 'CASHED_OUT' | 'LOST';
  cashedOutAt?: number;
  payoutCents?: number;
}

export interface CrashedRound {
  roundId: string;
  crashPoint: number;
}

export interface ChartPoint {
  elapsed: number;
  multiplier: number;
}

interface GameState {
  phase: GamePhase;
  roundId: string | null;
  multiplier: number;
  elapsed: number;
  waitingEndsAt: Date | null;
  startedAt: Date | null;
  activeBets: BetEntry[];
  myBet: BetEntry | null;
  walletBalanceCents: number | null;
  recentCrashes: CrashedRound[];
  chartPoints: ChartPoint[];
}

interface GameActions {
  setRoundState: (
    payload: {
      roundId: string | null;
      phase: GamePhase;
      multiplier: number;
      elapsed: number;
      activeBets: BetEntry[];
      waitingEndsAt?: Date;
      startedAt?: Date;
    },
    myUserId?: string,
  ) => void;
  setPhase: (payload: {
    roundId: string;
    phase: GamePhase;
    waitingEndsAt?: Date;
    startedAt?: Date;
    crashedAt?: Date;
  }) => void;
  addTick: (multiplier: number, elapsed: number) => void;
  setCrashed: (roundId: string, crashPoint: number) => void;
  addBet: (bet: BetEntry, myUserId?: string) => void;
  updateBet: (bet: BetEntry, myUserId?: string) => void;
  setMyBet: (bet: BetEntry) => void;
  setWalletBalance: (cents: number) => void;
}

function buildSyntheticChart(elapsed: number): ChartPoint[] {
  const points: ChartPoint[] = [];
  const step = 300;
  for (let t = 0; t <= elapsed; t += step) {
    points.push({
      elapsed: t,
      multiplier: Math.floor(Math.exp(t / 15000) * 100) / 100,
    });
  }
  return points;
}

export const useGameStore = create<GameState & GameActions>()(
  immer(set => ({
    phase: 'IDLE',
    roundId: null,
    multiplier: 1.0,
    elapsed: 0,
    waitingEndsAt: null,
    startedAt: null,
    activeBets: [],
    myBet: null,
    walletBalanceCents: null,
    recentCrashes: [],
    chartPoints: [],

    setRoundState: (payload, myUserId) => {
      set(state => {
        state.phase = payload.phase;
        state.roundId = payload.roundId;
        state.multiplier = payload.multiplier;
        state.elapsed = payload.elapsed;
        state.waitingEndsAt = payload.waitingEndsAt ?? null;
        state.startedAt = payload.startedAt ?? null;
        state.activeBets = payload.activeBets;

        if (myUserId) {
          state.myBet =
            payload.activeBets.find(b => b.userId === myUserId) ?? null;
        }

        // Rebuild chart on reconnect mid-round
        if (payload.phase === 'RUNNING' && payload.elapsed > 0) {
          const points = buildSyntheticChart(payload.elapsed);
          points.push({
            elapsed: payload.elapsed,
            multiplier: payload.multiplier,
          });
          state.chartPoints = points;
        } else {
          state.chartPoints = [];
        }
      });
    },

    setPhase: payload => {
      set(state => {
        state.phase = payload.phase;
        state.roundId = payload.roundId;

        if (payload.phase === 'WAITING') {
          state.waitingEndsAt = payload.waitingEndsAt ?? null;
          state.multiplier = 1.0;
          state.elapsed = 0;
          state.activeBets = [];
          state.myBet = null;
          state.chartPoints = [];
        } else if (payload.phase === 'RUNNING') {
          state.startedAt = payload.startedAt ?? null;
          state.chartPoints = [{ elapsed: 0, multiplier: 1.0 }];
        }
      });
    },

    addTick: (multiplier, elapsed) => {
      set(state => {
        state.multiplier = multiplier;
        state.elapsed = elapsed;
        state.chartPoints.push({ elapsed, multiplier });
      });
    },

    setCrashed: (roundId, crashPoint) => {
      set(state => {
        state.phase = 'CRASHED';
        state.multiplier = crashPoint;

        state.recentCrashes.unshift({ roundId, crashPoint });
        if (state.recentCrashes.length > 20) {
          state.recentCrashes = state.recentCrashes.slice(0, 20);
        }

        if (state.myBet?.status === 'ACTIVE') {
          state.myBet.status = 'LOST';
        }
        for (const bet of state.activeBets) {
          if (bet.status === 'ACTIVE') {
            bet.status = 'LOST';
          }
        }
      });
    },

    addBet: (bet, myUserId) => {
      set(state => {
        const idx = state.activeBets.findIndex(b => b.userId === bet.userId);
        if (idx >= 0) {
          state.activeBets[idx] = bet;
        } else {
          state.activeBets.push(bet);
        }
        if (myUserId && bet.userId === myUserId) {
          state.myBet = bet;
        }
      });
    },

    updateBet: (bet, myUserId) => {
      set(state => {
        const idx = state.activeBets.findIndex(b => b.userId === bet.userId);
        if (idx >= 0) {
          state.activeBets[idx] = bet;
        }
        if (myUserId && bet.userId === myUserId) {
          state.myBet = bet;
        }
      });
    },

    setMyBet: bet => {
      set(state => {
        state.myBet = bet;
        const idx = state.activeBets.findIndex(b => b.userId === bet.userId);
        if (idx >= 0) {
          state.activeBets[idx] = bet;
        } else {
          state.activeBets.push(bet);
        }
      });
    },

    setWalletBalance: cents => {
      set(state => {
        state.walletBalanceCents = cents;
      });
    },
  })),
);
