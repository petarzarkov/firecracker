import { describe, expect, test } from 'bun:test';
import { getTestContext } from '../setup/context.js';

interface Frame {
  event: string;
  data: unknown;
}

const open = (origin: string, token?: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${origin.replace(/^http/, 'ws')}/ws`,
      token === undefined
        ? undefined
        : { headers: { authorization: `Bearer ${token}` } },
    );
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', () => reject(new Error('refused')), {
      once: true,
    });
  });

const frame = (socket: WebSocket, event: string): Promise<Frame> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event}`)), 5000);
    const listener = (message: MessageEvent): void => {
      const parsed = JSON.parse(String(message.data)) as Frame;
      if (parsed.event !== event) return;
      clearTimeout(timer);
      socket.removeEventListener('message', listener);
      resolve(parsed);
    };
    socket.addEventListener('message', listener);
  });

/**
 * The gateway shares the HTTP server, so this connects to the same port the REST
 * calls use - there is no second listener and no `/socket.io` path.
 */
describe('websocket gateway against a live server', () => {
  /**
   * The template's gateway refused an anonymous upgrade with a 401. This one must
   * not: watching the rocket climb is what a visitor does before signing up, and
   * the lobby and crash history are public. What a spectator cannot do is spend
   * money, which the next test covers.
   */
  test('an anonymous upgrade is accepted, and gets the game state', async () => {
    const { origin } = getTestContext();
    const socket = await open(origin);

    const state = await frame(socket, 'gameRoundState');
    expect(state.data).toMatchObject({
      recentCrashes: expect.any(Array),
      activeBets: expect.any(Array),
    });

    socket.close();
  });

  test('a spectator cannot bet', async () => {
    const { origin } = getTestContext();
    const socket = await open(origin);
    await frame(socket, 'gameRoundState');

    const ack = frame(socket, 'betAck');
    socket.send(
      JSON.stringify({
        event: 'placeBet',
        data: { betAmountCents: 100, isDemo: true },
      }),
    );

    expect((await ack).data).toMatchObject({
      success: false,
      error: 'Login required to place bets',
    });

    socket.close();
  });

  test('a bearer token opens the socket and identifies the caller', async () => {
    const { origin, adminToken } = getTestContext();
    const socket = await open(origin, adminToken);

    const connected = await frame(socket, 'connected');
    expect(
      (connected.data as { payload: { email: string } }).payload.email,
    ).toBeDefined();

    socket.close();
  });

  test('an authenticated socket is handed its demo wallet', async () => {
    const { origin, adminToken } = getTestContext();
    const socket = await open(origin, adminToken);

    const wallet = await frame(socket, 'walletUpdated');
    expect(wallet.data).toMatchObject({ isDemo: true });
    expect(
      (wallet.data as { balanceCents: number }).balanceCents,
    ).toBeGreaterThan(0);

    socket.close();
  });

  test('a chat message is echoed to the sender and broadcast to the room', async () => {
    const { origin, adminToken } = getTestContext();
    const listener = await open(origin, adminToken);
    await frame(listener, 'connected');
    const sender = await open(origin, adminToken);
    await frame(sender, 'connected');

    const heard = frame(listener, 'message');
    const echoed = frame(sender, 'chatMessage');
    sender.send(JSON.stringify({ event: 'chatMessage', data: 'e2e hello' }));

    expect((await echoed).data).toEqual({ delivered: 1 });
    expect((await heard).data).toMatchObject({ message: 'e2e hello' });

    listener.close();
    sender.close();
  });

  /**
   * The `?token=` fallback, which exists because a browser cannot set a header on
   * a WebSocket and better-auth's cookie is `SameSite=Lax`. The header path above
   * is what a server-to-server client uses; this is what the browser uses.
   */
  test('a token in the query string authenticates the same way', async () => {
    const { origin, adminToken } = getTestContext();
    const socket = await new Promise<WebSocket>((resolve, reject) => {
      // `encodeURIComponent` is not optional: a better-auth token is base64 and
      // routinely contains `/`, `+` and `=`. Unencoded, `+` arrives as a space and
      // the session does not resolve. The client shim gets this right for free
      // because it builds the URL through `searchParams.set`.
      const ws = new WebSocket(
        `${origin.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(adminToken)}`,
      );
      ws.addEventListener('open', () => resolve(ws), { once: true });
      ws.addEventListener('error', () => reject(new Error('refused')), {
        once: true,
      });
    });

    const connected = await frame(socket, 'connected');
    expect(connected.data).toBeDefined();

    socket.close();
  });
});
