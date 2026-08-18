/**
 * A socket.io-shaped client over a plain WebSocket.
 *
 * ## Why this exists
 *
 * The server moved from socket.io to `@dunx/http`, whose gateways are native
 * `Bun.serve` WebSockets. dunx cannot speak the socket.io protocol and never will -
 * that protocol is a framing layer, a handshake, an ack scheme and a transport
 * negotiation, and Bun's WebSocket is none of it.
 *
 * What the wire actually needs is small: one JSON object, `{ event, data }`. So
 * rather than rewrite every component that calls `socket.emit('placeBet', …)` and
 * `socket.on('gameTick', …)`, this file provides those two methods over that
 * envelope. `useGameSocket`, `BetPanel`, `GlobalChat` and the rest are unchanged.
 *
 * ## What it deliberately does not reimplement
 *
 * socket.io has acks, rooms addressed from the client, binary attachments,
 * multiplexed namespaces and long-polling fallback. None of them were used by this
 * app, and each one reimplemented here would be a bug waiting to happen. Rooms are
 * server-side (Bun topics), replies come back as ordinary events, and there is no
 * fallback transport because Bun requires a real WebSocket anyway.
 */

/**
 * How a listener is held once its parameter type is erased.
 *
 * socket.io typed its listeners `any`, which is why every handler in this app
 * reads its payload without a cast. Keeping that ergonomics without an `any` means
 * making `on` generic: the caller declares what it expects, the store holds
 * `unknown`, and the one cast is here rather than at every call site.
 */
type StoredListener = (data: unknown) => void;

export interface SocketOptions {
  /** Sent as `?token=`, which the gateway promotes to an `Authorization` header. */
  readonly token?: string | undefined;
  /** Gateway path. `/ws` unless the server was reconfigured. */
  readonly path?: string;
  readonly reconnection?: boolean;
  readonly reconnectionAttempts?: number;
  readonly reconnectionDelay?: number;
  readonly reconnectionDelayMax?: number;
}

/**
 * The events this shim raises itself rather than receiving from the server. Named
 * so a listener for one of them is never confused with a wire event of the same
 * name - and so `connect_error` keeps carrying an `Error`, which callers read
 * `.message` off.
 */
const LOCAL_EVENTS = new Set([
  'connect',
  'disconnect',
  'connect_error',
  'error',
]);

/** The `socket.io` manager surface, reduced to the one event this app used. */
class Manager {
  readonly #listeners = new Map<string, Set<StoredListener>>();

  on<T = unknown>(event: string, listener: (data: T) => void): this {
    let set = this.#listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener as StoredListener);
    return this;
  }

  off<T = unknown>(event: string, listener?: (data: T) => void): this {
    if (listener === undefined) this.#listeners.delete(event);
    else this.#listeners.get(event)?.delete(listener as StoredListener);
    return this;
  }

  emitLocal(event: string, data?: unknown): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(data);
  }
}

export class Socket {
  readonly io = new Manager();

  #ws: WebSocket | null = null;
  #listeners = new Map<string, Set<StoredListener>>();
  #attempts = 0;
  #closed = false;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Frames emitted before the socket opened. socket.io buffered these, and code
   * that emits straight after `io()` relies on it - `useWebSocket` does exactly
   * that on reconnect.
   */
  #pending: string[] = [];

  readonly #url: string;
  readonly #options: Required<Omit<SocketOptions, 'token'>> &
    Pick<SocketOptions, 'token'>;

  constructor(url: string, options: SocketOptions = {}) {
    this.#url = url;
    this.#options = {
      token: options.token,
      path: options.path ?? '/ws',
      reconnection: options.reconnection ?? true,
      reconnectionAttempts: options.reconnectionAttempts ?? 5,
      reconnectionDelay: options.reconnectionDelay ?? 1000,
      reconnectionDelayMax: options.reconnectionDelayMax ?? 5000,
    };
    this.#open();
  }

  get connected(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  /** socket.io exposed a server-assigned id. Nothing here needs one that matches. */
  get id(): string | undefined {
    return this.connected ? 'ws' : undefined;
  }

  on<T = unknown>(event: string, listener: (data: T) => void): this {
    let set = this.#listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener as StoredListener);
    return this;
  }

  off<T = unknown>(event: string, listener?: (data: T) => void): this {
    if (listener === undefined) this.#listeners.delete(event);
    else this.#listeners.get(event)?.delete(listener as StoredListener);
    return this;
  }

  /**
   * `{"event":name,"data":payload}` - the envelope `@OnMessage(name)` decodes.
   *
   * `data` is omitted entirely when undefined so that `emit('cashOut')` sends
   * `{"event":"cashOut"}`, which is what a handler taking no payload expects.
   */
  emit(event: string, data?: unknown): this {
    const frame = JSON.stringify(
      data === undefined ? { event } : { event, data },
    );
    if (this.connected) this.#ws?.send(frame);
    else this.#pending.push(frame);
    return this;
  }

  disconnect(): this {
    this.#closed = true;
    if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#ws?.close(1000, 'client disconnect');
    this.#ws = null;
    return this;
  }

  #open(): void {
    if (this.#closed) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.#endpoint());
    } catch (error) {
      this.#dispatch('connect_error', error);
      this.#scheduleRetry();
      return;
    }
    this.#ws = ws;

    ws.onopen = () => {
      this.#attempts = 0;
      for (const frame of this.#pending.splice(0)) ws.send(frame);
      this.#dispatch('connect', undefined);
    };

    ws.onmessage = (message: MessageEvent) => {
      if (typeof message.data !== 'string') return;

      let frame: { event?: unknown; data?: unknown };
      try {
        frame = JSON.parse(message.data) as typeof frame;
      } catch {
        return;
      }
      if (typeof frame.event !== 'string') return;

      this.#dispatch(frame.event, frame.data);
    };

    ws.onerror = () => {
      // The browser deliberately gives no detail here, so there is nothing to
      // pass on but the fact of it. The close that follows carries the reason.
      this.#dispatch('connect_error', new Error('websocket error'));
    };

    ws.onclose = (event: CloseEvent) => {
      this.#ws = null;
      // 1000 is us calling `disconnect()`. Anything else is the server going away
      // or the network dropping, both of which are worth retrying.
      this.#dispatch(
        'disconnect',
        event.code === 1000 ? 'io client disconnect' : 'transport close',
      );
      if (event.code !== 1000) this.#scheduleRetry();
    };
  }

  #endpoint(): string {
    const base = this.#url === '' ? window.location.origin : this.#url;
    const url = new URL(this.#options.path, base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    if (this.#options.token !== undefined) {
      url.searchParams.set('token', this.#options.token);
    }
    return url.toString();
  }

  /** Exponential backoff, capped, and bounded by `reconnectionAttempts`. */
  #scheduleRetry(): void {
    if (this.#closed || !this.#options.reconnection) return;

    if (this.#attempts >= this.#options.reconnectionAttempts) {
      this.io.emitLocal('reconnect_failed');
      return;
    }

    const delay = Math.min(
      this.#options.reconnectionDelay * 2 ** this.#attempts,
      this.#options.reconnectionDelayMax,
    );
    this.#attempts += 1;
    this.#retryTimer = setTimeout(() => this.#open(), delay);
  }

  #dispatch(event: string, data: unknown): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(data);
    if (!LOCAL_EVENTS.has(event)) return;
  }
}

/** Drop-in for socket.io-client's `io()`. */
export const io = (url: string, options: SocketOptions = {}): Socket =>
  new Socket(url, options);
