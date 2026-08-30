import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../../app.module.js';
import {
  dropTestNamespaces,
  testNamespace,
} from '../../test-support/namespace.js';
import { GAME_CLIENT_EVENTS, GAME_EVENTS } from '../game.events.js';

/**
 * The socket had no rate limit at all, and a client bug is what found that out: a
 * loop sent `placeBet` roughly every millisecond, and every frame reached the bet
 * path. `ThrottleGuard` could never have covered it - it reads a `BunRequest` - so
 * this reuses the one thing that is transport-agnostic, `ThrottleStore`.
 *
 * Driven over a real `WebSocket`, because the middleware chain, the subject and the
 * refusal frame are the whole feature and a fake socket exercises none of them.
 */
const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: ':memory:',
  QUEUE_CONSUME: 'false',
  // The HTTP limit is deliberately out of the way: this file is about the socket's.
  THROTTLE_LIMIT: '10000',
  ...testNamespace(),
};

let server: TestServer;

const connect = async (): Promise<WebSocket> => {
  const url = `${server.url.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`;
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('refused')), {
      once: true,
    });
  });
  return socket;
};

interface Frame {
  readonly event: string;
  readonly data: { success?: boolean; error?: string };
}

/** Every frame of one event, collected as it arrives. */
const collect = (socket: WebSocket, event: string): Frame[] => {
  const seen: Frame[] = [];
  socket.addEventListener('message', (message: MessageEvent) => {
    const parsed = JSON.parse(String(message.data)) as Frame;
    if (parsed.event === event) seen.push(parsed);
  });
  return seen;
};

const send = (socket: WebSocket, event: string, data: unknown): void => {
  socket.send(JSON.stringify({ event, data }));
};

const settle = (): Promise<void> => Bun.sleep(600);

beforeAll(async () => {
  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    requestLogging: false,
  });
});

afterAll(async () => {
  await server.close();
  await dropTestNamespaces();
});

describe('socket rate limiting', () => {
  /**
   * A spectator has no player, so it is refused for being anonymous rather than for
   * being fast - which is the point: the limit has to bite *before* the handler, so
   * the refusals must outnumber what an unlimited socket would have produced.
   */
  test('a burst of bets is cut off, and the sender is told', async () => {
    const socket = await connect();
    const acks = collect(socket, GAME_EVENTS.BET_ACK);

    // The shape of the bug: as fast as the socket will take them.
    for (let i = 0; i < 40; i++) {
      send(socket, GAME_CLIENT_EVENTS.PLACE_BET, {
        betAmountCents: 100,
        isDemo: true,
      });
    }
    await settle();
    socket.close();

    // Every frame is answered - a silent drop is indistinguishable from a hang.
    expect(acks.length).toBeGreaterThan(0);
    const throttled = acks.filter((ack) => ack.data.error === 'Slow down');
    expect(throttled.length).toBeGreaterThan(0);
    // 5 per window, so a burst of 40 is mostly refusals.
    expect(throttled.length).toBeGreaterThan(acks.length / 2);
    for (const ack of throttled) expect(ack.data.success).toBe(false);
  });

  /**
   * The counter is per subject, and a spectator's subject is its connection - so a
   * second socket is a second budget. That is the documented cost of having no id
   * to key on, and it is why the limit is keyed on the *player* the moment there is
   * one.
   */
  test('a fresh connection gets its own budget', async () => {
    const first = await connect();
    const firstAcks = collect(first, GAME_EVENTS.BET_ACK);
    for (let i = 0; i < 20; i++) {
      send(first, GAME_CLIENT_EVENTS.PLACE_BET, {
        betAmountCents: 100,
        isDemo: true,
      });
    }
    await settle();
    first.close();
    expect(
      firstAcks.filter((ack) => ack.data.error === 'Slow down').length,
    ).toBeGreaterThan(0);

    const second = await connect();
    const secondAcks = collect(second, GAME_EVENTS.BET_ACK);
    send(second, GAME_CLIENT_EVENTS.PLACE_BET, {
      betAmountCents: 100,
      isDemo: true,
    });
    await settle();
    second.close();

    expect(secondAcks).toHaveLength(1);
    expect(secondAcks[0]?.data.error).not.toBe('Slow down');
  });

  /** An event with no entry in the table is not the client's to flood, and passes. */
  test('an unlimited event is untouched', async () => {
    const socket = await connect();
    const states = collect(socket, GAME_EVENTS.ROUND_STATE);
    await settle();
    socket.close();
    // The connect frames arrive without any of this getting in the way.
    expect(states.length).toBeGreaterThan(0);
  });
});
