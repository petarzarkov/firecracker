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

/**
 * What became of one `chatMessage`.
 *
 * A separate name from the message that asked for it, and that is the whole reason
 * this exists: dunx answers `@OnMessage('x')` with the handler's return value under
 * the name `x`, so the gateway's rejections went out as `chatMessage` frames and no
 * client has ever registered a listener for one. "Login required to chat" and the
 * 1000-character refusal both reached the browser and were dropped there - the
 * input cleared and nothing happened.
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
 * What a notification is about.
 *
 * Its own wire value rather than the name of the job that produced it: a job name
 * is the server talking to itself, and a name a browser can read is a name somebody
 * will send. So `user.registered` stays server-side and this is what crosses.
 */
export const NotificationKind = Object.freeze({
  USER_REGISTERED: 'userRegistered',
  USER_BANNED: 'userBanned',
} as const);
export type NotificationKind =
  (typeof NotificationKind)[keyof typeof NotificationKind];

/**
 * One notice, sent to a user's own topic or to the admin room.
 *
 * The text is written **by the publisher**, because a browser cannot be expected to
 * know what a job meant. It is also the whole reason this type exists: the four
 * publishes it replaces carried `{userId,email,name}`, `{userId,email}`,
 * `{email,role}` and `{userId,reason}` under one event name - four shapes for one
 * frame, which is what an unchecked `Record<string, unknown>` permits - and nothing
 * on the client read any of them.
 */
export interface NotificationPayload {
  readonly kind: NotificationKind;
  readonly title: string;
  readonly message: string;
}

/**
 * Every server-sent event that is not the game's, with the payload it carries.
 *
 * The counterpart of `GamePayloads`, and it did not exist: these six went out
 * through a publisher that takes `unknown`, which is the hole all four historical
 * drift bugs came through.
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

/** The one-to-one rooms. `ROOM_CREATED` reaches the other participant's own topic. */
export interface PlayerChatPayloads {
  readonly [PLAYER_CHAT_EVENTS.ROOM_CREATED]: PlayerChatRoom;
  readonly [PLAYER_CHAT_EVENTS.ROOM_JOINED]: PlayerChatRoom;
  readonly [PLAYER_CHAT_EVENTS.MESSAGE]: PlayerChatMessagePayload;
  readonly [PLAYER_CHAT_EVENTS.SYSTEM_MESSAGE]: PlayerChatSystemPayload;
}
