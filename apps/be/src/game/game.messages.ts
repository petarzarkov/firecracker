import { BetRejected } from './services/game-bet.service.js';

/**
 * What a client is allowed to send, and what it becomes.
 *
 * Hand-written rather than a schema, because `@OnMessage` hands the handler a
 * decoded payload and there is no route decorator to hang one off. Three small
 * parsers beat pulling zod onto the socket path for this.
 *
 * Split out of `game.gateway.ts` because that file crossed 500 lines. The split
 * is along a real seam: nothing here touches a service, a socket or Redis, so it
 * is testable on its own.
 */

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

/**
 * `{ roomId?, targetUserId? }`, needing at least one.
 *
 * The client sends `targetUserId: ''` alongside a `roomId` when it re-joins, so
 * an empty string has to read as absent rather than as a user whose id is `""`.
 */
export const parseJoinChat = (data: unknown): JoinChatRequest | null => {
  if (typeof data !== 'object' || data === null) return null;
  const { roomId, targetUserId } = data as Record<string, unknown>;

  const room =
    typeof roomId === 'string' && roomId.length > 0 ? roomId : undefined;
  const target =
    typeof targetUserId === 'string' && targetUserId.length > 0
      ? targetUserId
      : undefined;

  if (room === undefined && target === undefined) return null;
  return { roomId: room, targetUserId: target };
};

export interface PlayerMessageRequest {
  readonly roomId: string;
  readonly message: string;
}

export const parsePlayerMessage = (
  data: unknown,
): PlayerMessageRequest | null => {
  if (typeof data !== 'object' || data === null) return null;
  const { roomId, message } = data as Record<string, unknown>;

  if (typeof roomId !== 'string' || roomId.length === 0) return null;
  if (typeof message !== 'string' || message.length === 0) return null;
  // The same ceiling the global chat uses. A direct message is not a file upload.
  if (message.length > 1000) return null;

  return { roomId, message };
};

export const parseRoomId = (data: unknown): string | null => {
  if (typeof data === 'string' && data.length > 0) return data;
  if (typeof data !== 'object' || data === null) return null;
  const { roomId } = data as Record<string, unknown>;
  return typeof roomId === 'string' && roomId.length > 0 ? roomId : null;
};
