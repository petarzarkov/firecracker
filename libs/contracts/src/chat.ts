/**
 * Everything on the socket that is not the game: the connection handshake, the
 * lobby's chat, and the one-to-one rooms two players open from the lobby list.
 */

/** What the server sends outside the game's own events. */
export const SOCKET_EVENTS = Object.freeze({
  CONNECTED: 'connected',
  NOTIFICATION: 'notification',
  MESSAGE: 'message',
  /** The chat scrollback, sent once per connection. */
  CHAT_HISTORY: 'chatHistory',
  USER_COUNT: 'userCount',
} as const);

/** What a client sends. */
export const SOCKET_CLIENT_EVENTS = Object.freeze({
  CHAT_MESSAGE: 'chatMessage',
} as const);

export const PLAYER_CHAT_EVENTS = Object.freeze({
  ROOM_CREATED: 'playerChatRoomCreated',
  ROOM_JOINED: 'playerChatRoomJoined',
  MESSAGE: 'playerChatMessage',
  SYSTEM_MESSAGE: 'playerChatSystemMessage',
} as const);

/**
 * The caller, sent once on `connected`.
 *
 * The `{ payload }` envelope is the client's shape, kept because renaming it would
 * mean editing React for no gain.
 */
export interface ConnectedPayload {
  readonly payload: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
    readonly picture: string | null;
  };
}

/**
 * One line of lobby chat - live on `message`, and replayed on `chatHistory`.
 *
 * The two are the same type on purpose. They diverged once: history was sent as
 * `username` while the client read `senderName`, and the chat panel crashed on
 * render.
 *
 * `timestamp` is an ISO string, because that is what survives `JSON.stringify`.
 * Typing it as `Date` describes the server's local variable rather than the frame
 * the browser receives.
 */
export interface ChatLine {
  readonly username: string;
  readonly message: string;
  readonly timestamp: string;
  /** The sender's avatar when they sent it. `null` if they had none. */
  readonly picture: string | null;
}

export interface PlayerChatRoom {
  readonly roomId: string;
  readonly participants: readonly string[];
  readonly participantNames: Readonly<Record<string, string>>;
  readonly creatorId: string;
  readonly creatorName: string;
}

export interface PlayerChatMessagePayload {
  readonly roomId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly message: string;
  readonly timestamp: string;
}

export interface PlayerChatSystemPayload {
  readonly roomId: string;
  readonly message: string;
  readonly timestamp: string;
  readonly type: 'join' | 'leave';
}
