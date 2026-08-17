import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type GamePhase = 'IDLE' | 'WAITING' | 'RUNNING' | 'CRASHED';

export interface BetEntry {
  userId: string;
  username: string;
  betAmountCents: number;
  status: 'ACTIVE' | 'CASHED_OUT' | 'LOST';
  cashedOutAt?: number | undefined;
  payoutCents?: number | undefined;
  /** True when the update was applied locally before server confirmation. */
  isOptimistic?: boolean | undefined;
}

export interface CrashedRound {
  roundId: string;
  crashPoint: number;
}

export interface ChartPoint {
  elapsed: number;
  multiplier: number;
}

/**
 * Mutable ref holding live tick data.
 * Updated directly by addTick — NO Zustand set() call → no React re-renders on tick.
 * Canvas RAF loops in CrashChart / BetPanel / PlayerList read this directly.
 */
export const liveRef: {
  multiplier: number;
  chartPoints: ChartPoint[];
  /** Client-side timestamp (ms) for when the current round started. Set on RUNNING. */
  roundStartedAtMs: number | null;
} = {
  multiplier: 1.0,
  chartPoints: [],
  roundStartedAtMs: null,
};

/** Multiplier divisor — must match GAME.MULTIPLIER_DIVISOR on the server. */
const MULTIPLIER_DIVISOR = 10_000;

/**
 * Returns the interpolated current multiplier using the client's clock.
 * When roundStartedAtMs is known this matches the server's live value exactly,
 * eliminating the tick-interval gap on the cashout button display.
 * Falls back to the last received tick value when not running.
 */
export function getLiveMultiplier(): number {
  if (liveRef.roundStartedAtMs != null) {
    const elapsed = Date.now() - liveRef.roundStartedAtMs;
    return Math.floor(Math.exp(elapsed / MULTIPLIER_DIVISOR) * 100) / 100;
  }
  return liveRef.multiplier;
}

interface GameState {
  phase: GamePhase;
  roundId: string | null;
  multiplier: number;
  waitingEndsAt: Date | null;
  startedAt: Date | null;
  activeBets: BetEntry[];
  myBet: BetEntry | null;
  walletBalanceCents: number | null;
  demoBalanceCents: number | null;
  recentCrashes: CrashedRound[];
  betError: string | null;
  isDemoMode: boolean;
}

interface GameActions {
  setRoundState: (
    payload: {
      roundId: string | null;
      phase: GamePhase;
      multiplier: number;
      elapsed: number;
      activeBets: BetEntry[];
      waitingEndsAt?: Date | undefined;
      startedAt?: Date | undefined;
      recentCrashes?: CrashedRound[] | undefined;
    },
    myUserId?: string,
  ) => void;
  setPhase: (payload: {
    roundId: string;
    phase: GamePhase;
    waitingEndsAt?: Date | undefined;
    startedAt?: Date | undefined;
    crashedAt?: Date | undefined;
  }) => void;
  addTick: (multiplier: number, elapsed: number) => void;
  setCrashed: (roundId: string, crashPoint: number) => void;
  addBet: (bet: BetEntry, myUserId?: string) => void;
  updateBet: (bet: BetEntry, myUserId?: string) => void;
  setMyBet: (bet: BetEntry) => void;
  setWalletBalance: (cents: number) => void;
  setDemoBalance: (cents: number) => void;
  clearActiveBets: () => void;
  setBetError: (error: string | null) => void;
  clearBetError: () => void;
  setIsDemoMode: (isDemoMode: boolean) => void;
  /** Removes the optimistic place-bet entry when the server rejects it. */
  rollbackBet: () => void;
  /**
   * Rolls back an optimistic cashout. Sets the status back to ACTIVE
   * (or LOST if the round has already crashed) so the store is consistent
   * regardless of which event — cashOutAck or gameCrashed — arrives first.
   */
  rollbackCashOut: () => void;
}

function buildSyntheticChart(elapsed: number): ChartPoint[] {
  const points: ChartPoint[] = [];
  const step = 300;
  for (let t = 0; t <= elapsed; t += step) {
    points.push({
      elapsed: t,
      multiplier: Math.floor(Math.exp(t / 10000) * 100) / 100,
    });
  }
  return points;
}

export const useGameStore = create<GameState & GameActions>()(
  immer((set) => ({
    phase: 'IDLE',
    roundId: null,
    multiplier: 1.0,
    waitingEndsAt: null,
    startedAt: null,
    activeBets: [],
    myBet: null,
    walletBalanceCents: null,
    demoBalanceCents: null,
    recentCrashes: [],
    betError: null,
    isDemoMode: true,

    setRoundState: (payload, myUserId) => {
      // Populate liveRef for canvas RAF rendering (reconnect mid-round)
      if (payload.phase === 'RUNNING' && payload.elapsed > 0) {
        const points = buildSyntheticChart(payload.elapsed);
        points.push({
          elapsed: payload.elapsed,
          multiplier: payload.multiplier,
        });
        liveRef.chartPoints = points;
        // Back-compute startedAt from elapsed so the interpolation matches the server
        liveRef.roundStartedAtMs = Date.now() - payload.elapsed;
      } else {
        liveRef.chartPoints = [];
        liveRef.roundStartedAtMs = null;
      }
      liveRef.multiplier = payload.multiplier ?? 1.0;

      set((state) => {
        state.phase = payload.phase;
        state.roundId = payload.roundId;
        state.multiplier = payload.multiplier;
        state.waitingEndsAt = payload.waitingEndsAt ?? null;
        state.startedAt = payload.startedAt ?? null;
        state.activeBets = payload.activeBets;

        if (myUserId) {
          state.myBet =
            payload.activeBets.find((b) => b.userId === myUserId) ?? null;
        }

        if (payload.recentCrashes && payload.recentCrashes.length > 0) {
          state.recentCrashes = payload.recentCrashes;
        }
      });
    },

    setPhase: (payload) => {
      set((state) => {
        state.phase = payload.phase;
        state.roundId = payload.roundId;

        if (payload.phase === 'WAITING') {
          liveRef.chartPoints = [];
          liveRef.multiplier = 1.0;
          liveRef.roundStartedAtMs = null;
          state.waitingEndsAt = payload.waitingEndsAt ?? null;
          state.multiplier = 1.0;
          state.activeBets = [];
          state.myBet = null;
        } else if (payload.phase === 'RUNNING') {
          liveRef.chartPoints = [{ elapsed: 0, multiplier: 1.0 }];
          liveRef.multiplier = 1.0;
          liveRef.roundStartedAtMs = Date.now();
          state.startedAt = payload.startedAt ?? null;
        } else if (payload.phase === 'CRASHED') {
          liveRef.roundStartedAtMs = null;
        }
      });
    },

    addTick: (multiplier, elapsed) => {
      // Only update liveRef — NO Zustand set() → no React re-renders per tick.
      // CrashChart canvas and any RAF-based components read liveRef directly.
      liveRef.multiplier = multiplier;
      liveRef.chartPoints.push({ elapsed, multiplier });
    },

    setCrashed: (roundId, crashPoint) => {
      // Update liveRef BEFORE Zustand so the canvas sees the crash point
      // on the same frame as the phase transition to CRASHED.
      liveRef.multiplier = crashPoint;

      set((state) => {
        state.phase = 'CRASHED';
        state.multiplier = crashPoint;

        state.recentCrashes.unshift({ roundId, crashPoint });
        if (state.recentCrashes.length > 20) {
          state.recentCrashes = state.recentCrashes.slice(0, 20);
        }

        // ACTIVE bets are lost. Optimistic cashouts that the server hadn't
        // confirmed yet are also treated as lost (crash arrived before ack).
        if (
          state.myBet &&
          (state.myBet.status === 'ACTIVE' || state.myBet.isOptimistic)
        ) {
          state.myBet.status = 'LOST';
          state.myBet.isOptimistic = false;
          state.myBet.cashedOutAt = undefined;
          state.myBet.payoutCents = undefined;
        }
        for (const bet of state.activeBets) {
          if (bet.status === 'ACTIVE' || bet.isOptimistic) {
            bet.status = 'LOST';
            bet.isOptimistic = false;
            bet.cashedOutAt = undefined;
            bet.payoutCents = undefined;
          }
        }
      });
    },

    addBet: (bet, myUserId) => {
      set((state) => {
        const idx = state.activeBets.findIndex((b) => b.userId === bet.userId);
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

    updateBet: (bet, _myUserId) => {
      set((state) => {
        const idx = state.activeBets.findIndex((b) => b.userId === bet.userId);
        if (idx >= 0) {
          state.activeBets[idx] = bet;
        }
        if (state.myBet?.userId === bet.userId) {
          state.myBet = bet;
        }
      });
    },

    setMyBet: (bet) => {
      set((state) => {
        state.myBet = bet;
        const idx = state.activeBets.findIndex((b) => b.userId === bet.userId);
        if (idx >= 0) {
          state.activeBets[idx] = bet;
        } else {
          state.activeBets.push(bet);
        }
      });
    },

    setWalletBalance: (cents) => {
      set((state) => {
        state.walletBalanceCents = cents;
      });
    },

    setDemoBalance: (cents) => {
      set((state) => {
        state.demoBalanceCents = cents;
      });
    },

    clearActiveBets: () => {
      set((state) => {
        state.activeBets = [];
      });
    },

    setBetError: (error) => {
      set((state) => {
        state.betError = error;
      });
    },

    clearBetError: () => {
      set((state) => {
        state.betError = null;
      });
    },

    setIsDemoMode: (isDemoMode) => {
      set((state) => {
        state.isDemoMode = isDemoMode;
      });
    },

    rollbackBet: () => {
      set((state) => {
        const myBet = state.myBet;
        if (myBet) {
          const idx = state.activeBets.findIndex(
            (b) => b.userId === myBet.userId,
          );
          if (idx >= 0) state.activeBets.splice(idx, 1);
          state.myBet = null;
        }
      });
    },

    rollbackCashOut: () => {
      set((state) => {
        const myBet = state.myBet;
        if (myBet?.isOptimistic && myBet.status === 'CASHED_OUT') {
          // If round crashed before our ack arrived, mark as lost — otherwise restore active
          const newStatus = state.phase === 'CRASHED' ? 'LOST' : 'ACTIVE';
          const idx = state.activeBets.findIndex(
            (b) => b.userId === myBet.userId,
          );
          const rolled = idx >= 0 ? state.activeBets[idx] : undefined;
          if (rolled !== undefined) {
            rolled.status = newStatus;
            rolled.isOptimistic = false;
            rolled.cashedOutAt = undefined;
            rolled.payoutCents = undefined;
          }
          myBet.status = newStatus;
          myBet.isOptimistic = false;
          myBet.cashedOutAt = undefined;
          myBet.payoutCents = undefined;
        }
      });
    },
  })),
);
