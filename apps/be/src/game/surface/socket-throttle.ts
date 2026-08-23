import { Logger } from '@dunx/core';
import {
  ThrottleOptions,
  ThrottleStore,
  type SocketContext,
  type SocketFrame,
  type SocketMiddleware,
  type SocketNext,
} from '@dunx/http';
import { EVENTS } from '../../notifications/events/events.js';
import { GAME_CLIENT_EVENTS, GAME_EVENTS } from '../game.events.js';
import { CLIENT_EVENTS } from '../../notifications/events/events.js';
import type { GameSocketContext } from './socket-auth.service.js';

/**
 * How a refusal reaches the sender.
 *
 * `null` for a frame the gateway answers with nothing: dropping it silently is the
 * whole behaviour there, and inventing an ack the client has no listener for is the
 * mistake `chatAck` was created to undo.
 */
type Refusal = { readonly event: string; readonly data: unknown } | null;

interface Limit {
  /** Frames allowed per {@link WINDOW_SECONDS}. */
  readonly perWindow: number;
  readonly refuse: Refusal;
}

/**
 * One window for every event, because the limits differ by an order of magnitude
 * and a per-event window would only make two numbers to reason about instead of one.
 */
const WINDOW_SECONDS = 10;

const refusal = 'Slow down';

/**
 * What a client may send, and how often.
 *
 * These are **cadences of the game**, not operator tuning: a round lasts tens of
 * seconds and a player may hold one bet in it, so five `placeBet` frames in ten
 * seconds is already generous for a human and ruinous for the loop that sent one
 * every millisecond. Anything absent from this table is unlimited - `gameTick` is
 * outbound, and the lifecycle frames are not the client's to send.
 */
const LIMITS: Readonly<Record<string, Limit>> = Object.freeze({
  [GAME_CLIENT_EVENTS.PLACE_BET]: {
    perWindow: 5,
    refuse: {
      event: GAME_EVENTS.BET_ACK,
      data: { success: false, error: refusal },
    },
  },
  [GAME_CLIENT_EVENTS.CANCEL_BET]: {
    // Paired with the bet it takes back, so the same cadence: a player holds one
    // bet per round and cancelling more often than that is a loop, not a mind
    // being changed.
    perWindow: 5,
    refuse: {
      event: GAME_EVENTS.CANCEL_BET_ACK,
      data: { success: false, error: refusal },
    },
  },
  [GAME_CLIENT_EVENTS.CASH_OUT]: {
    // Looser than a bet: a player who thinks the button missed will press it again,
    // and the second press is settled by the bet row rather than by this.
    perWindow: 10,
    refuse: {
      event: GAME_EVENTS.CASH_OUT_ACK,
      data: { success: false, error: refusal },
    },
  },
  [GAME_CLIENT_EVENTS.SUBMIT_CLIENT_SEED]: {
    // Entropy is per round and keyed per player, so more than a handful is a client
    // stuffing the pool rather than contributing to it.
    perWindow: 5,
    refuse: {
      event: GAME_EVENTS.SEED_ACK,
      data: { success: false, error: refusal },
    },
  },
  [CLIENT_EVENTS.CHAT_MESSAGE]: {
    perWindow: 5,
    refuse: { event: EVENTS.CHAT_ACK, data: { error: refusal } },
  },
  [GAME_CLIENT_EVENTS.SEND_PLAYER_CHAT]: { perWindow: 10, refuse: null },
  [GAME_CLIENT_EVENTS.JOIN_PLAYER_CHAT]: { perWindow: 10, refuse: null },
});

/**
 * A rate limit for the socket, on the same counter the HTTP routes use.
 *
 * `@dunx/http`'s `ThrottleGuard` is a `Middleware` and reads a `BunRequest`, so it
 * cannot see a frame - but `ThrottleStore` is transport-agnostic (`hit(key, window)`
 * and nothing else), and `ThrottleModule` binds it. Reusing it means one Redis
 * counter, one prefix and one story about what happens when Redis is unreachable,
 * rather than a second limiter with its own answers.
 *
 * Counted **per player**, falling back to the connection for a spectator: a limit
 * keyed on the socket alone is defeated by opening another one, and a spectator has
 * no id to key on.
 *
 * Refusals are **sent, not thrown**. A throw would reach `SocketErrorReporter` and
 * put a `warn` in the log for every frame of an abusive loop - the flood would move
 * from the game to the log rather than stopping - and the sender would get nothing
 * back to explain itself.
 */
export class SocketThrottle implements SocketMiddleware {
  constructor(
    private readonly store: ThrottleStore,
    private readonly options: ThrottleOptions,
    private readonly logger: Logger,
  ) {}

  handle(frame: SocketFrame, ctx: SocketContext, next: SocketNext): unknown {
    const limit = ctx.event === undefined ? undefined : LIMITS[ctx.event];
    if (limit === undefined) return next();
    return this.#limited(frame, ctx.event as string, limit, next);
  }

  async #limited(
    frame: SocketFrame,
    event: string,
    limit: Limit,
    next: SocketNext,
  ): Promise<unknown> {
    const subject = SocketThrottle.#subject(frame);
    const key = `${this.options.prefix}:ws:${event}:${subject}`;

    // `undefined` is an unreachable store, which the HTTP guard reads as "allow".
    // The same answer here: a limiter that turns a Redis outage into a dead socket
    // has done more damage than the abuse it exists to stop.
    const count = await this.store.hit(key, WINDOW_SECONDS);
    if (count === undefined || count <= limit.perWindow) return next();

    // Once per window, not once per frame - the frames are the flood.
    if (count === limit.perWindow + 1) {
      this.logger.debug('socket frame rate limited', {
        event,
        subject,
        perWindow: limit.perWindow,
        windowSeconds: WINDOW_SECONDS,
      });
    }

    if (limit.refuse !== null) {
      frame.socket.send(
        JSON.stringify({ event: limit.refuse.event, data: limit.refuse.data }),
      );
    }
    return undefined;
  }

  /** The player, or the connection when there is no player to name. */
  static #subject(frame: SocketFrame): string {
    const socket = frame.socket as {
      data: { id: string; context?: GameSocketContext };
    };
    return socket.data.context?.player?.userId ?? socket.data.id;
  }
}
