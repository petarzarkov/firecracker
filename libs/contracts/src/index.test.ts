import { describe, expect, test } from 'bun:test';
import {
  GAME_CLIENT_EVENTS,
  GAME_EVENTS,
  PLAYER_CHAT_EVENTS,
  SOCKET_CLIENT_EVENTS,
  SOCKET_EVENTS,
} from './index.js';

/**
 * There is **one** socket. The game, the lobby chat and the direct-message rooms
 * all ride it, which is what makes the event name the only routing there is - and
 * why two of them being equal is not a style problem but a silently shadowed
 * handler on a connection carrying somebody's money.
 *
 * Three separate files declared these names before this package existed. Nothing
 * compared them.
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
