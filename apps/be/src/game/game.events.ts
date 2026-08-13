/**
 * Every queue name, job name, socket topic and socket event the game uses, in one
 * file, because three processes have to agree on all of them: the web process
 * publishes and ticks, the worker consumes and transitions, and a browser
 * subscribes.
 *
 * The names are the ones the NestJS version used on the wire, so the client's
 * event handlers did not have to be renamed - only its transport did.
 */

/** The game's own queue. Its own so round transitions cannot queue behind email. */
export const GAME_QUEUE = 'game' as const;

export const GAME_JOBS = Object.freeze({
  /** Create the next round and open its betting window. */
  SCHEDULE: 'game.round.schedule',
  /** Close the window, draw the crash point, start the tick loop. */
  START: 'game.round.start',
  /** Settle every open bet and reveal the seed. */
  CRASH: 'game.round.crash',
  /** Periodic sweep for rounds that stalled. */
  CLEANUP: 'game.round.cleanup',
} as const);
export type GameJobName = (typeof GAME_JOBS)[keyof typeof GAME_JOBS];

/** Bun pub/sub topic every spectator is subscribed to. */
export const GAME_TOPIC = 'game' as const;

/**
 * What the server sends. The envelope on the wire is `{"event":..,"data":..}`,
 * which is what the client's shim unwraps back into `socket.on(name, data)`.
 */
export const GAME_EVENTS = Object.freeze({
  ROUND_STATE: 'gameRoundState',
  PHASE_CHANGE: 'gamePhaseChange',
  TICK: 'gameTick',
  CRASHED: 'gameCrashed',
  BET_PLACED: 'betPlaced',
  BET_CASHED_OUT: 'betCashedOut',
  BET_ACK: 'betAck',
  CASH_OUT_ACK: 'cashOutAck',
  SEED_ACK: 'seedAck',
  WALLET_UPDATED: 'walletUpdated',
} as const);

/** What a client sends. */
export const GAME_CLIENT_EVENTS = Object.freeze({
  PLACE_BET: 'placeBet',
  CASH_OUT: 'cashOut',
  SUBMIT_CLIENT_SEED: 'submitClientSeed',
} as const);

// ── Job payloads ────────────────────────────────────────────────────────────

export interface RoundJob {
  readonly roundId: string;
}

// ── Socket payloads ─────────────────────────────────────────────────────────

export type GamePhase = 'waiting' | 'running' | 'crashed' | 'failed';

export interface ActiveBetView {
  readonly username: string;
  readonly betAmountCents: number;
  readonly isDemo: boolean;
  readonly cashedOutAt?: number;
}

export interface CrashedRoundSummary {
  readonly roundId: string;
  readonly crashPoint: number;
}

export interface GameRoundStatePayload {
  readonly phase: GamePhase;
  readonly roundId: string | null;
  readonly seedHash: string | null;
  readonly nonce?: number;
  readonly recentCrashes: readonly CrashedRoundSummary[];
  readonly activeBets: readonly ActiveBetView[];
  readonly multiplier?: number;
  readonly elapsed?: number;
  readonly waitingEndsAt?: string;
}

export interface GamePhasePayload {
  readonly phase: GamePhase;
  readonly roundId: string;
  readonly seedHash: string;
  readonly nonce: number;
  readonly waitingEndsAt?: string;
}

export interface GameTickPayload {
  readonly multiplier: number;
  readonly elapsed: number;
}

/**
 * The crash, with everything a player needs to check it. `algorithm` is new: the
 * draw is `@arkv/rng` seeded from `serverSeed:clientSeed:nonce`, so a verifier has
 * to know which generator produced it.
 */
export interface GameCrashedPayload {
  readonly roundId: string;
  readonly crashPoint: number;
  readonly crashedAt: string;
  readonly seed: string;
  readonly clientSeed: string;
  readonly nonce: number;
  readonly algorithm: string;
}

export interface BetPlacedPayload {
  readonly username: string;
  readonly betAmountCents: number;
  readonly isDemo: boolean;
}

export interface BetCashedOutPayload {
  readonly username: string;
  readonly multiplier: number;
  readonly payoutCents: number;
  readonly isDemo: boolean;
}

export interface BetAckPayload {
  readonly success: boolean;
  readonly username?: string;
  readonly betAmountCents?: number;
  readonly error?: string;
}

export interface CashOutAckPayload {
  readonly success: boolean;
  readonly multiplier?: number;
  readonly payoutCents?: number;
  readonly error?: string;
}

export interface SeedAckPayload {
  readonly success: boolean;
  readonly error?: string;
}

export interface WalletUpdatedPayload {
  readonly balanceCents: number;
  readonly isDemo: boolean;
}
