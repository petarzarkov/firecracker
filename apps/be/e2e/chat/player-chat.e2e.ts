import { describe, expect, test } from 'bun:test';
import { getTestContext } from '../setup/context.js';

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

/**
 * A socket that records every frame from the instant it is constructed.
 *
 * Attaching a listener after `open` resolves is a race: the gateway sends
 * `gameRoundState`, `connected` and `walletUpdated` immediately, and a listener
 * added a tick later has already missed them. This buffers instead, so a test can
 * ask for a frame that already arrived.
 */
const openSocket = (origin: string, token: string) => {
  const frames: Frame[] = [];
  const ws = new WebSocket(
    `${origin.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`,
  );
  ws.addEventListener('message', (message: MessageEvent) => {
    frames.push(JSON.parse(String(message.data)) as Frame);
  });

  const ready = new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('refused')), {
      once: true,
    });
  });

  /** The next frame of this name, consuming it so a later call gets the one after. */
  const next = async (
    event: string,
    timeoutMs = 4000,
  ): Promise<Frame['data']> => {
    const started = Bun.nanoseconds();
    for (;;) {
      const index = frames.findIndex((frame) => frame.event === event);
      if (index !== -1) return frames.splice(index, 1)[0]!.data;
      if ((Bun.nanoseconds() - started) / 1e6 > timeoutMs) {
        throw new Error(`no ${event}`);
      }
      await Bun.sleep(20);
    }
  };

  return { ws, ready, next };
};

const signUp = async (
  origin: string,
  name: string,
): Promise<{ token: string; id: string }> => {
  const response = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `${name}-${crypto.randomUUID()}@example.com`,
      password: 'a-password-123',
      name,
    }),
  });
  const body = (await response.json()) as {
    token?: string;
    user?: { id: string };
  };
  if (!body.user) throw new Error(`sign-up failed for ${name}`);
  return {
    token: response.headers.get('set-auth-token') ?? body.token ?? '',
    id: body.user.id,
  };
};

describe('player-to-player chat', () => {
  test('two players get one room, and it reaches both of them', async () => {
    const { origin } = getTestContext();
    const ada = await signUp(origin, 'ada');
    const grace = await signUp(origin, 'grace');

    const a = openSocket(origin, ada.token);
    const g = openSocket(origin, grace.token);
    await Promise.all([a.ready, g.ready]);
    await Promise.all([a.next('connected'), g.next('connected')]);

    a.ws.send(
      JSON.stringify({
        event: 'joinPlayerChat',
        data: { roomId: '', targetUserId: grace.id },
      }),
    );

    const room = await a.next('playerChatRoomJoined');
    expect(room['roomId']).toBeTruthy();

    // Grace is told without having asked - the room reaches her user topic.
    const created = await g.next('playerChatRoomCreated');
    expect(created['roomId']).toBe(room['roomId']);
    expect(Object.keys(created['participantNames'] as object)).toHaveLength(2);

    g.ws.send(
      JSON.stringify({
        event: 'joinPlayerChat',
        data: { roomId: room['roomId'], targetUserId: '' },
      }),
    );
    await g.next('playerChatRoomJoined');

    a.ws.send(
      JSON.stringify({
        event: 'sendPlayerChatMessage',
        data: { roomId: room['roomId'], message: 'gl hf' },
      }),
    );
    const heard = await g.next('playerChatMessage');
    expect(heard['message']).toBe('gl hf');
    expect(heard['senderName']).toBe('ada');

    /**
     * The room id is a hash of the two user ids sorted, so Grace opening it from
     * her side lands in the same room rather than a second one. Without the sort
     * this is where the pair would end up with two.
     */
    g.ws.send(
      JSON.stringify({
        event: 'joinPlayerChat',
        data: { roomId: '', targetUserId: ada.id },
      }),
    );
    expect((await g.next('playerChatRoomJoined'))['roomId']).toBe(
      room['roomId'],
    );

    a.ws.close();
    g.ws.close();
  });

  /**
   * The room id is a hash of two user ids, not a secret - so membership has to be
   * checked server-side on every join and every message. This is that check.
   */
  test('a third player cannot join or read the room', async () => {
    const { origin } = getTestContext();
    const ada = await signUp(origin, 'ada');
    const grace = await signUp(origin, 'grace');
    const mallory = await signUp(origin, 'mallory');

    const a = openSocket(origin, ada.token);
    const m = openSocket(origin, mallory.token);
    await Promise.all([a.ready, m.ready]);
    await Promise.all([a.next('connected'), m.next('connected')]);

    a.ws.send(
      JSON.stringify({
        event: 'joinPlayerChat',
        data: { roomId: '', targetUserId: grace.id },
      }),
    );
    const room = await a.next('playerChatRoomJoined');

    m.ws.send(
      JSON.stringify({
        event: 'joinPlayerChat',
        data: { roomId: room['roomId'], targetUserId: '' },
      }),
    );
    const refusal = await m.next('playerChatSystemMessage');
    expect(String(refusal['message'])).toContain('not available');

    // And the refusal is real: a message sent afterwards does not reach them.
    a.ws.send(
      JSON.stringify({
        event: 'sendPlayerChatMessage',
        data: { roomId: room['roomId'], message: 'secret' },
      }),
    );
    await expect(m.next('playerChatMessage', 500)).rejects.toThrow(
      'no playerChatMessage',
    );

    a.ws.close();
    m.ws.close();
  });
});
