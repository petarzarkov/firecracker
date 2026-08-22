/**
 * The three payload maps, merged into one.
 *
 * There is **one** socket: the game, the lobby chat, the direct-message rooms and
 * the notifications all ride it, so the event name is the only routing there is.
 * That makes the merged map the honest description of what can arrive on a
 * connection - and it is what lets one `send` on the server and one `on` in the
 * browser be checked against the name they were given.
 *
 * The maps stay separate where they are declared, because a publisher usually
 * belongs to one family and narrowing its argument catches a frame sent to the
 * wrong half.
 */
import type { GameClientPayloads, GamePayloads } from './game.js';
import type {
  PlayerChatPayloads,
  SocketClientPayloads,
  SocketPayloads,
} from './chat.js';

export type ServerPayloads = GamePayloads & SocketPayloads & PlayerChatPayloads;

/**
 * Everything a client may send, which is the half that was not declared anywhere.
 *
 * The names were shared; the bodies were an object literal in a React component and
 * a hand-written parser on the server, with nothing comparing the two - the exact
 * precondition of all four drift bugs. `Socket.emit` is typed against this, so a
 * component that sends the wrong shape stops compiling.
 */
export type ClientPayloads = GameClientPayloads & SocketClientPayloads;
