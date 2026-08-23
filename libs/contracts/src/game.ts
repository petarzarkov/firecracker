/**
 * The game's socket wire.
 *
 * The envelope is `{ event, data }`. `GamePayloads` maps every event name to what
 * it carries, which is what makes a mismatched publish a compile error on the
 * server and a mismatched handler a compile error on the client.
 */

import type {
  JoinPlayerChatMessage,
  LeavePlayerChatMessage,
  SendPlayerChatMessage,
} from './chat.js';

/** Bun pub/sub topic every spectator is subscribed to. */
export const GAME_TOPIC = 'game' as const;

/** What the server sends. */
export const GAME_EVENTS = Object.freeze({
  ROUND_STATE: 'gameRoundState',
  PHASE_CHANGE: 'gamePhaseChange',
  TICK: 'gameTick',
  CRASHED: 'gameCrashed',
  BET_PLACED: 'betPlaced',
  /** Somebody took their bet back. The lobby drops the row. */
  BET_CANCELLED: 'betCancelled',
  /** The answer to one `cancelBet`. */
  CANCEL_BET_ACK: 'cancelBetAck',
  BET_CASHED_OUT: 'betCashedOut',
  BET_ACK: 'betAck',
  CASH_OUT_ACK: 'cashOutAck',
  SEED_ACK: 'seedAck',
  WALLET_UPDATED: 'walletUpdated',
} as const);
export type GameEvent = (typeof GAME_EVENTS)[keyof typeof GAME_EVENTS];

/** What a client sends. */
export const GAME_CLIENT_EVENTS = Object.freeze({
  PLACE_BET: 'placeBet',
  /** Take a bet back before the launch. Only during the betting window. */
  CANCEL_BET: 'cancelBet',
  CASH_OUT: 'cashOut',
  SUBMIT_CLIENT_SEED: 'submitClientSeed',
  JOIN_PLAYER_CHAT: 'joinPlayerChat',
  SEND_PLAYER_CHAT: 'sendPlayerChatMessage',
  LEAVE_PLAYER_CHAT: 'leavePlayerChat',
} as const);

export type GamePhase = 'waiting' | 'running' | 'crashed' | 'failed';

/**
 * What a client may send under `GAME_CLIENT_EVENTS`. The three `playerChat` names
 * are here because a client sends them on the game's connection - there is only one
 * - while their bodies stay in `chat.ts` with the rest of the chat.
 */
export interface GameClientPayloads {
  readonly [GAME_CLIENT_EVENTS.PLACE_BET]: PlaceBetMessage;
  readonly [GAME_CLIENT_EVENTS.CASH_OUT]: CashOutMessage;
  readonly [GAME_CLIENT_EVENTS.CANCEL_BET]: Record<string, never>;
  readonly [GAME_CLIENT_EVENTS.SUBMIT_CLIENT_SEED]: SubmitClientSeedMessage;
  readonly [GAME_CLIENT_EVENTS.JOIN_PLAYER_CHAT]: JoinPlayerChatMessage;
  readonly [GAME_CLIENT_EVENTS.SEND_PLAYER_CHAT]: SendPlayerChatMessage;
  readonly [GAME_CLIENT_EVENTS.LEAVE_PLAYER_CHAT]: LeavePlayerChatMessage;
}

/**
 * One player's stake, as the lobby shows it. `userId` is not decoration: keyed on
 * the display name instead, two players called the same thing collapse into one row.
 */
export interface ActiveBetView {
  readonly userId: string;
  readonly username: string;
  readonly betAmountCents: number;
  readonly isDemo: boolean;
  readonly cashedOutAt?: number;
  /** What they won, once they have. The lobby shows money, not just a rate. */
  readonly payoutCents?: number;
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
 * The crash, with everything needed to check it. `algorithm` is part of that: the
 * draw is seeded from `serverSeed:clientSeed:nonce`, so a verifier has to know
 * which generator produced the number.
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
  readonly userId: string;
  readonly username: string;
  readonly betAmountCents: number;
  readonly isDemo: boolean;
}

/**
 * A bet withdrawn during the betting window. Only the id, because the row it names
 * is gone: a cancelled bet is one that did not happen, and the wallet ledger keeps
 * the debit and the refund either way.
 */
export interface BetCancelledPayload {
  readonly userId: string;
}

export interface CancelBetAckPayload {
  readonly success: boolean;
  readonly error?: string;
  /** The stake handed back, when there was one. */
  readonly refundedCents?: number;
}

export interface BetCashedOutPayload {
  /** Who cashed out. Without it a client cannot tell whether it was them. */
  readonly userId: string;
  readonly username: string;
  readonly multiplier: number;
  readonly payoutCents: number;
  readonly isDemo: boolean;
}

export interface BetAckPayload {
  readonly success: boolean;
  /** The caller's own id, so the ack can be matched to the bet it acknowledges. */
  readonly userId?: string;
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

/**
 * The body of a `placeBet`. `autoCashOutAt` is a multiplier, not hundredths - it is
 * a number a player typed, and the conversion happens server-side.
 */
export interface PlaceBetMessage {
  readonly betAmountCents: number;
  readonly isDemo: boolean;
  readonly autoCashOutAt?: number | undefined;
}

/**
 * The body of a `cashOut`, which is usually nothing at all: the server prefers the
 * open bet's own mode over anything a client says, because defaulting to real money
 * here once made every demo cash-out fail silently.
 */
export interface CashOutMessage {
  readonly isDemo?: boolean | undefined;
}

/** The body of a `submitClientSeed`. 1 to 128 characters. */
export interface SubmitClientSeedMessage {
  readonly seed: string;
}

/** Every server-sent game event, with the payload it carries. */
export interface GamePayloads {
  readonly [GAME_EVENTS.ROUND_STATE]: GameRoundStatePayload;
  readonly [GAME_EVENTS.PHASE_CHANGE]: GamePhasePayload;
  readonly [GAME_EVENTS.TICK]: GameTickPayload;
  readonly [GAME_EVENTS.CRASHED]: GameCrashedPayload;
  readonly [GAME_EVENTS.BET_PLACED]: BetPlacedPayload;
  readonly [GAME_EVENTS.BET_CANCELLED]: BetCancelledPayload;
  readonly [GAME_EVENTS.CANCEL_BET_ACK]: CancelBetAckPayload;
  readonly [GAME_EVENTS.BET_CASHED_OUT]: BetCashedOutPayload;
  readonly [GAME_EVENTS.BET_ACK]: BetAckPayload;
  readonly [GAME_EVENTS.CASH_OUT_ACK]: CashOutAckPayload;
  readonly [GAME_EVENTS.SEED_ACK]: SeedAckPayload;
  readonly [GAME_EVENTS.WALLET_UPDATED]: WalletUpdatedPayload;
}
