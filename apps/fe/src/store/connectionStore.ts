import { create } from 'zustand';

/**
 * Whether the client and the server are still talking.
 *
 * Its own store rather than a field on `gameStore` because it is not part of a
 * round: `gameStore` holds what the server last said, and this holds whether the
 * server is still saying anything. Keeping them apart is what lets the banner
 * render while the chart goes on showing the last state it was told about.
 */
export type ConnectionStatus =
  /** The first socket of this session has not opened yet. */
  | 'connecting'
  /** Open. */
  | 'online'
  /** Dropped, and the shim is backing off toward another attempt. */
  | 'reconnecting'
  /** The shim gave up. Only {@link Socket.connect} gets out of this one. */
  | 'offline';

interface ConnectionState {
  readonly status: ConnectionStatus;
  /** Which retry is in flight. `0` outside `reconnecting`. */
  readonly attempt: number;
  setStatus: (status: ConnectionStatus, attempt?: number) => void;
}

/**
 * How many times the shim retries before it stops and waits to be asked.
 *
 * Ten, with the capped backoff in `socket.ts`, is a little over a minute - long
 * enough to ride out a deploy or a laptop waking up, short enough that a player on
 * a genuinely dead connection gets a button rather than a spinner forever. The
 * banner counts against it, so it lives here and is passed in rather than being
 * written twice.
 */
export const RECONNECT_ATTEMPTS = 10;

export const useConnectionStore = create<ConnectionState>()((set) => ({
  status: 'connecting',
  attempt: 0,
  setStatus: (status, attempt = 0) => {
    set((state) =>
      state.status === status && state.attempt === attempt
        ? state
        : { status, attempt },
    );
  },
}));
