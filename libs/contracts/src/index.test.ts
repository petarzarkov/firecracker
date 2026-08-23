import { describe, expect, test } from 'bun:test';
import {
  GAME_CLIENT_EVENTS,
  GAME_EVENTS,
  PLAYER_CHAT_EVENTS,
  SOCKET_CLIENT_EVENTS,
  SOCKET_EVENTS,
  type GameClientPayloads,
  type GamePayloads,
  type PlayerChatPayloads,
  type SocketClientPayloads,
  type SocketPayloads,
} from './index.js';

/**
 * There is **one** socket, so the event name is the only routing there is - and two
 * of them being equal is a silently shadowed handler on a connection carrying
 * somebody's money, not a style problem.
 */
const serverSent = [GAME_EVENTS, SOCKET_EVENTS, PLAYER_CHAT_EVENTS];
const clientSent = [GAME_CLIENT_EVENTS, SOCKET_CLIENT_EVENTS];

const names = (groups: readonly Readonly<Record<string, string>>[]) =>
  groups.flatMap((group) => Object.values(group));

describe('the event names', () => {
  test('no two server-sent events share a name', () => {
    const sent = names(serverSent);
    expect(new Set(sent).size).toBe(sent.length);
  });

  test('no two client-sent events share a name', () => {
    const sent = names(clientSent);
    expect(new Set(sent).size).toBe(sent.length);
  });

  /**
   * A name used in both directions would make an echo indistinguishable from a
   * request, and the gateway replies on the socket it was called on.
   */
  test('nothing is both an inbound and an outbound name', () => {
    const inbound = new Set(names(clientSent));
    for (const outbound of names(serverSent)) {
      expect(inbound.has(outbound)).toBe(false);
    }
  });

  /**
   * The names are the wire. Renaming one is a deploy where the server and the
   * browser stop talking, so they are pinned here rather than left to a rename
   * refactor that looks safe in one repo half.
   */
  test('the wire names are what the deployed client listens for', () => {
    expect(Object.values(GAME_EVENTS)).toEqual([
      'gameRoundState',
      'gamePhaseChange',
      'gameTick',
      'gameCrashed',
      'betPlaced',
      'betCancelled',
      'cancelBetAck',
      'betCashedOut',
      'betAck',
      'cashOutAck',
      'seedAck',
      'walletUpdated',
    ]);
    expect(Object.values(SOCKET_EVENTS)).toEqual([
      'connected',
      'notification',
      'message',
      'chatHistory',
      'userCount',
      'chatAck',
    ]);
  });

  test('the name objects are frozen', () => {
    for (const group of [...serverSent, ...clientSent]) {
      expect(Object.isFrozen(group)).toBe(true);
    }
  });
});

/**
 * A payload map's keys, at run time.
 *
 * A map is a type and a type is not there when the test runs, so this is the only
 * honest way to get at one: `Record<keyof Map, true>` makes the **compiler** demand
 * exactly one entry per event - a payload nobody named is a missing property, and a
 * key that is not an event is an excess one - and the object it leaves behind can
 * then be compared with the name table those events are published under.
 *
 * The entries are written through the name constants rather than as string
 * literals, so this file cannot be the place a fourth copy of the wire's spelling
 * drifts. That is also why the two directions fail differently and deliberately:
 * a **name with no payload** fails the expectations below under `bun test`, and a
 * **payload with no name** fails `bun run typecheck` right here. Both run in CI.
 */
type Witness<TPayloads> = Record<keyof TPayloads, true>;

const gamePayloads: Witness<GamePayloads> = {
  [GAME_EVENTS.ROUND_STATE]: true,
  [GAME_EVENTS.PHASE_CHANGE]: true,
  [GAME_EVENTS.TICK]: true,
  [GAME_EVENTS.CRASHED]: true,
  [GAME_EVENTS.BET_PLACED]: true,
  [GAME_EVENTS.BET_CANCELLED]: true,
  [GAME_EVENTS.CANCEL_BET_ACK]: true,
  [GAME_EVENTS.BET_CASHED_OUT]: true,
  [GAME_EVENTS.BET_ACK]: true,
  [GAME_EVENTS.CASH_OUT_ACK]: true,
  [GAME_EVENTS.SEED_ACK]: true,
  [GAME_EVENTS.WALLET_UPDATED]: true,
};

const socketPayloads: Witness<SocketPayloads> = {
  [SOCKET_EVENTS.CONNECTED]: true,
  [SOCKET_EVENTS.NOTIFICATION]: true,
  [SOCKET_EVENTS.MESSAGE]: true,
  [SOCKET_EVENTS.CHAT_HISTORY]: true,
  [SOCKET_EVENTS.USER_COUNT]: true,
  [SOCKET_EVENTS.CHAT_ACK]: true,
};

const playerChatPayloads: Witness<PlayerChatPayloads> = {
  [PLAYER_CHAT_EVENTS.ROOM_CREATED]: true,
  [PLAYER_CHAT_EVENTS.ROOM_JOINED]: true,
  [PLAYER_CHAT_EVENTS.MESSAGE]: true,
  [PLAYER_CHAT_EVENTS.SYSTEM_MESSAGE]: true,
};

const gameClientPayloads: Witness<GameClientPayloads> = {
  [GAME_CLIENT_EVENTS.PLACE_BET]: true,
  [GAME_CLIENT_EVENTS.CANCEL_BET]: true,
  [GAME_CLIENT_EVENTS.CASH_OUT]: true,
  [GAME_CLIENT_EVENTS.SUBMIT_CLIENT_SEED]: true,
  [GAME_CLIENT_EVENTS.JOIN_PLAYER_CHAT]: true,
  [GAME_CLIENT_EVENTS.SEND_PLAYER_CHAT]: true,
  [GAME_CLIENT_EVENTS.LEAVE_PLAYER_CHAT]: true,
};

const socketClientPayloads: Witness<SocketClientPayloads> = {
  [SOCKET_CLIENT_EVENTS.CHAT_MESSAGE]: true,
};

/** Both halves of the disagreement, so a failure names the gap rather than a count. */
const gaps = (
  witness: Readonly<Record<string, true>>,
  table: Readonly<Record<string, string>>,
) => {
  const named = Object.values(table);
  return {
    namesWithoutPayload: named.filter((name) => !(name in witness)),
    payloadsWithoutName: Object.keys(witness).filter(
      (key) => !named.includes(key),
    ),
  };
};

const agreed = { namesWithoutPayload: [], payloadsWithoutName: [] };

/**
 * The structural half of the pinned-names test above.
 *
 * `chatAck` is why it exists. The gateway answered a `chatMessage` by returning its
 * ack, dunx sent that back under the *inbound* name, and no client listened for
 * one - so a refusal to chat was dropped in the browser for months. The name never
 * reached a table, so nothing here could catch it; a table that has to be complete
 * would have. Two of the three drift bugs before it were the same absence: a
 * payload the server sent and no declaration to check it against.
 */
describe('the payload maps', () => {
  test('every game event has a payload and every payload an event', () => {
    expect(gaps(gamePayloads, GAME_EVENTS)).toEqual(agreed);
  });

  test('every non-game event has a payload and every payload an event', () => {
    expect(gaps(socketPayloads, SOCKET_EVENTS)).toEqual(agreed);
  });

  test('every player-chat event has a payload and every payload an event', () => {
    expect(gaps(playerChatPayloads, PLAYER_CHAT_EVENTS)).toEqual(agreed);
  });

  test('every inbound game name has a body and every body a name', () => {
    expect(gaps(gameClientPayloads, GAME_CLIENT_EVENTS)).toEqual(agreed);
  });

  test('every other inbound name has a body and every body a name', () => {
    expect(gaps(socketClientPayloads, SOCKET_CLIENT_EVENTS)).toEqual(agreed);
  });

  /**
   * One socket carries all of them, so a name in two families would shadow a
   * handler. The count is the assertion: five maps, no key twice.
   */
  test('no payload is declared in two families', () => {
    const keys = [
      ...Object.keys(gamePayloads),
      ...Object.keys(socketPayloads),
      ...Object.keys(playerChatPayloads),
      ...Object.keys(gameClientPayloads),
      ...Object.keys(socketClientPayloads),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
