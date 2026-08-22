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
  /** The answer to one `chatMessage`. See {@link ChatAckPayload}. */
  CHAT_ACK: 'chatAck',
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

/** The caller, sent once on `connected`. The envelope is the client's own shape. */
export interface ConnectedPayload {
  readonly payload: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
    readonly picture: string | null;
  };
}

/**
 * One line of lobby chat - live on `message`, replayed on `chatHistory`, and the
 * same type for both on purpose: they diverged once, history sending `username`
 * where the client read `senderName`, and the panel crashed on render.
 *
 * `timestamp` is an ISO string, because that is what survives `JSON.stringify`.
 */
export interface ChatLine {
  readonly username: string;
  readonly message: string;
  readonly timestamp: string;
  /** The sender's avatar when they sent it. `null` if they had none. */
  readonly picture: string | null;
}

/**
 * What became of one `chatMessage`, under a name of its own - which is the whole
 * reason it exists. dunx answers `@OnMessage('x')` under `x`, so returning an ack
 * sent it as a `chatMessage` frame no client listens for, and every rejection was
 * dropped in the browser.
 */
export interface ChatAckPayload {
  /** Present when the line went out. */
  readonly delivered?: number;
  /** Present instead when it did not, written to be shown to the sender. */
  readonly error?: string;
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

/**
 * Its own wire value rather than the job name that produced it: a job name is the
 * server talking to itself, and a name a browser can read is one somebody will
 * send.
 */
export const NotificationKind = Object.freeze({
  USER_REGISTERED: 'userRegistered',
  USER_BANNED: 'userBanned',
} as const);
export type NotificationKind =
  (typeof NotificationKind)[keyof typeof NotificationKind];

/**
 * One notice, sent to a user's own topic or to the admin room. The text is written
 * **by the publisher**, because a browser cannot know what a job meant - and the
 * four publishes this replaced carried four different shapes under one event name,
 * which is what an unchecked `Record<string, unknown>` permits.
 */
export interface NotificationPayload {
  readonly kind: NotificationKind;
  readonly title: string;
  readonly message: string;
}

/**
 * Every server-sent event that is not the game's. The counterpart of
 * `GamePayloads`; before it, these six went out through a publisher taking
 * `unknown`, which is the hole every drift bug came through.
 */
export interface SocketPayloads {
  readonly [SOCKET_EVENTS.CONNECTED]: ConnectedPayload;
  readonly [SOCKET_EVENTS.NOTIFICATION]: NotificationPayload;
  readonly [SOCKET_EVENTS.MESSAGE]: ChatLine;
  readonly [SOCKET_EVENTS.CHAT_HISTORY]: readonly ChatLine[];
  /** Subscribers on the node that sent it - see the gateway on why per-node. */
  readonly [SOCKET_EVENTS.USER_COUNT]: number;
  readonly [SOCKET_EVENTS.CHAT_ACK]: ChatAckPayload;
}

/**
 * The body of a `chatMessage`. The server also accepts a bare string, because both
 * shapes were once on the wire; this is the one a client should send.
 */
export interface ChatMessageBody {
  readonly message: string;
}

/**
 * A room to rejoin, or somebody to open one with; the server refuses a frame with
 * neither. An **empty string reads as absent**, because the client sends
 * `targetUserId: ''` beside a `roomId` when it reconnects.
 */
export interface JoinPlayerChatMessage {
  readonly roomId?: string | undefined;
  readonly targetUserId?: string | undefined;
}

/** The body of a `sendPlayerChatMessage`. The text is capped at 1000 characters. */
export interface SendPlayerChatMessage {
  readonly roomId: string;
  readonly message: string;
}

/** The body of a `leavePlayerChat`. */
export interface LeavePlayerChatMessage {
  readonly roomId: string;
}

/** What a client may send under `SOCKET_CLIENT_EVENTS`. */
export interface SocketClientPayloads {
  readonly [SOCKET_CLIENT_EVENTS.CHAT_MESSAGE]: ChatMessageBody;
}

/** The one-to-one rooms. `ROOM_CREATED` reaches the other participant's own topic. */
export interface PlayerChatPayloads {
  readonly [PLAYER_CHAT_EVENTS.ROOM_CREATED]: PlayerChatRoom;
  readonly [PLAYER_CHAT_EVENTS.ROOM_JOINED]: PlayerChatRoom;
  readonly [PLAYER_CHAT_EVENTS.MESSAGE]: PlayerChatMessagePayload;
  readonly [PLAYER_CHAT_EVENTS.SYSTEM_MESSAGE]: PlayerChatSystemPayload;
}
