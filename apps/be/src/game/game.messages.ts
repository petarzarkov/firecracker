import { BetRejected } from './services/game-bet.service.js';

export interface ParsedBet {
  readonly betAmountCents: number;
  readonly isDemo: boolean;
  readonly autoCashOutAt: number | undefined;
}

export const parseBet = (data: unknown): ParsedBet | null => {
  if (typeof data !== 'object' || data === null) return null;
  const { betAmountCents, isDemo, autoCashOutAt } = data as Record<
    string,
    unknown
  >;

  if (!Number.isInteger(betAmountCents)) return null;
  if (autoCashOutAt !== undefined) {
    if (typeof autoCashOutAt !== 'number' || autoCashOutAt < 1.01) return null;
  }

  return {
    betAmountCents: betAmountCents as number,
    isDemo: Boolean(isDemo),
    autoCashOutAt: autoCashOutAt as number | undefined,
  };
};

/** Accepts a bare string or `{ seed }`, because both shapes were on the wire. */
export const parseSeed = (data: unknown): string | null => {
  const seed =
    typeof data === 'string'
      ? data
      : typeof data === 'object' && data !== null && 'seed' in data
        ? (data as { seed?: unknown }).seed
        : undefined;
  if (typeof seed !== 'string' || seed.length === 0 || seed.length > 128) {
    return null;
  }
  return seed;
};

export const parseChat = (data: unknown): string | null => {
  const text =
    typeof data === 'string'
      ? data
      : typeof data === 'object' && data !== null && 'message' in data
        ? (data as { message?: unknown }).message
        : undefined;
  if (typeof text !== 'string' || text.length === 0 || text.length > 1000) {
    return null;
  }
  return text;
};

/**
 * A message safe to show a player. `BetRejected` is written for them; anything
 * else is ours and gets a generic line, because an internal error string in a
 * `betAck` is an information leak on a gambling surface.
 */
export const playerFacing = (error: unknown, fallback: string): string =>
  error instanceof BetRejected ? error.message : fallback;

export interface JoinChatRequest {
  /** Re-joining a room already known, typically after a reconnect. */
  readonly roomId: string | undefined;
  /** Opening a conversation with somebody, by their user id. */
  readonly targetUserId: string | undefined;
}

export interface PlayerMessageRequest {
  readonly roomId: string;
  readonly message: string;
}

/**
 * What a client is allowed to send, and what it becomes.
 *
 * Hand-written rather than a schema: `@OnMessage` hands the handler a decoded payload
 * and there is no route decorator to hang one off. Nothing here touches a service, a
 * socket or Redis, so it is testable on its own.
 *
 * Every parser returns `null` rather than throwing - a socket handler has no error
 * mapper behind it, so a rejected frame has to become an ack the client can read.
 */
export class GameMessages {
  /** The ceiling on any free text a client sends. A message is not a file upload. */
  static readonly #MAX_TEXT = 1000;
  static readonly #MAX_SEED = 128;

  static parseBet(data: unknown): ParsedBet | null {
    if (typeof data !== 'object' || data === null) return null;
    const { betAmountCents, isDemo, autoCashOutAt } = data as Record<
      string,
      unknown
    >;

    if (!Number.isInteger(betAmountCents)) return null;
    if (autoCashOutAt !== undefined) {
      if (typeof autoCashOutAt !== 'number' || autoCashOutAt < 1.01) {
        return null;
      }
    }

    return {
      betAmountCents: betAmountCents as number,
      isDemo: Boolean(isDemo),
      autoCashOutAt: autoCashOutAt as number | undefined,
    };
  }

  /** Accepts a bare string or `{ seed }`, because both shapes were on the wire. */
  static parseSeed(data: unknown): string | null {
    const seed = GameMessages.#text(data, 'seed');
    if (seed === null || seed.length > GameMessages.#MAX_SEED) return null;
    return seed;
  }

  static parseChat(data: unknown): string | null {
    const text = GameMessages.#text(data, 'message');
    if (text === null || text.length > GameMessages.#MAX_TEXT) return null;
    return text;
  }

  /**
   * `{ roomId?, targetUserId? }`, needing at least one.
   *
   * The client sends `targetUserId: ''` alongside a `roomId` when it re-joins, so
   * an empty string has to read as absent rather than as a user whose id is `""`.
   */
  static parseJoinChat(data: unknown): JoinChatRequest | null {
    if (typeof data !== 'object' || data === null) return null;
    const { roomId, targetUserId } = data as Record<string, unknown>;

    const room = GameMessages.#nonEmpty(roomId);
    const target = GameMessages.#nonEmpty(targetUserId);

    if (room === undefined && target === undefined) return null;
    return { roomId: room, targetUserId: target };
  }

  static parsePlayerMessage(data: unknown): PlayerMessageRequest | null {
    if (typeof data !== 'object' || data === null) return null;
    const { roomId, message } = data as Record<string, unknown>;

    if (typeof roomId !== 'string' || roomId.length === 0) return null;
    if (typeof message !== 'string' || message.length === 0) return null;
    // The same ceiling the global chat uses.
    if (message.length > GameMessages.#MAX_TEXT) return null;

    return { roomId, message };
  }

  static parseRoomId(data: unknown): string | null {
    return GameMessages.#text(data, 'roomId');
  }

  /**
   * A message safe to show a player. `BetRejected` is written for them; anything
   * else is ours and gets a generic line, because an internal error string in a
   * `betAck` is an information leak on a gambling surface.
   */
  static playerFacing(error: unknown, fallback: string): string {
    return error instanceof BetRejected ? error.message : fallback;
  }

  /** A bare string, or the named property of an object. Three parsers accept both. */
  static #text(data: unknown, key: string): string | null {
    if (typeof data === 'string') {
      return data.length > 0 ? data : null;
    }
    if (typeof data !== 'object' || data === null) return null;
    const value = (data as Record<string, unknown>)[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  static #nonEmpty(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
