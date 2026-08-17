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
  JOIN_PLAYER_CHAT: 'joinPlayerChat',
  SEND_PLAYER_CHAT: 'sendPlayerChatMessage',
  LEAVE_PLAYER_CHAT: 'leavePlayerChat',
} as const);

/**
 * One-to-one chat. A topic per room rather than one topic filtered on the client,
 * because a client that receives a message it then hides has still received it.
 */
export const playerChatTopic = (roomId: string): string =>
  `player_chat_${roomId}`;

export const PLAYER_CHAT_EVENTS = Object.freeze({
  ROOM_CREATED: 'playerChatRoomCreated',
  ROOM_JOINED: 'playerChatRoomJoined',
  MESSAGE: 'playerChatMessage',
  SYSTEM_MESSAGE: 'playerChatSystemMessage',
} as const);

export interface PlayerChatRoom {
  readonly roomId: string;
  readonly participants: readonly string[];
  readonly participantNames: Readonly<Record<string, string>>;
  readonly creatorId: string;
  readonly creatorName: string;
}

// ── Job payloads ────────────────────────────────────────────────────────────

export interface RoundJob {
  readonly roundId: string;
}

// ── Socket payloads ─────────────────────────────────────────────────────────

export type GamePhase = 'waiting' | 'running' | 'crashed' | 'failed';

export interface ActiveBetView {
  /**
   * Added for player chat: a DM needs somebody to address, and the lobby list is
   * the only place a player sees another player. It also gives the client a real
   * dedup key - it was using `username`, which two players can share.
   */
  readonly userId: string;
  readonly username: string;
  readonly betAmountCents: number;
  readonly isDemo: boolean;
  readonly cashedOutAt?: number;
  /**
   * What they won, once they have. The lobby shows the amount rather than only
   * the multiplier - a multiplier is a rate, and the interesting number is money.
   */
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
  readonly userId: string;
  readonly username: string;
  readonly betAmountCents: number;
  readonly isDemo: boolean;
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
  /**
   * The caller's own id, so the ack is self-contained.
   *
   * Without it the client keyed its confirmation row on the *username*, which no
   * longer matches the id `betPlaced` carries - so a single bet rendered as two
   * players. An ack that cannot be matched to the thing it acknowledges is not an
   * ack.
   */
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
 * Every server-sent game event, with the payload it carries.
 *
 * ## Why this exists
 *
 * `EventsPublisher.publish` takes `unknown`, so nothing checked that a frame
 * matched the interface named after it. Three separate bugs came out of that gap,
 * all the same shape: `betPlaced`, `betAck` and `betCashedOut` each went out
 * without the `userId` a client needs to recognise itself, and each one was found
 * by a person looking at a screen rather than by a compiler.
 *
 * Publishing through {@link publishGame} makes the payload a type error instead.
 */
export interface GamePayloads {
  readonly [GAME_EVENTS.ROUND_STATE]: GameRoundStatePayload;
  readonly [GAME_EVENTS.PHASE_CHANGE]: GamePhasePayload;
  readonly [GAME_EVENTS.TICK]: GameTickPayload;
  readonly [GAME_EVENTS.CRASHED]: GameCrashedPayload;
  readonly [GAME_EVENTS.BET_PLACED]: BetPlacedPayload;
  readonly [GAME_EVENTS.BET_CASHED_OUT]: BetCashedOutPayload;
  readonly [GAME_EVENTS.BET_ACK]: BetAckPayload;
  readonly [GAME_EVENTS.CASH_OUT_ACK]: CashOutAckPayload;
  readonly [GAME_EVENTS.SEED_ACK]: SeedAckPayload;
  readonly [GAME_EVENTS.WALLET_UPDATED]: WalletUpdatedPayload;
}

/**
 * Publish a game frame, with the payload checked against the event name.
 *
 * A thin wrapper over `EventsPublisher.publish`, which takes `unknown` because it
 * serves chat and notifications too. Every game publish goes through here.
 */
export const publishGame = <E extends keyof GamePayloads>(
  events: { publish: (topic: string, event: string, data: unknown) => void },
  topic: string,
  event: E,
  data: GamePayloads[E],
): void => {
  events.publish(topic, event, data);
};
