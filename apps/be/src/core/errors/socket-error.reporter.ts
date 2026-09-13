import { Logger } from '@dunx/core';
import {
  HttpStatusCode,
  SocketObserver,
  type SocketContext,
  type SocketFrame,
  type SocketOutcome,
} from '@dunx/http';
import { ErrorMapper } from './error-mapper.js';

/**
 * What `onError` is on the HTTP side, for the socket.
 *
 * A socket middleware and **not** `SocketOptions.onError`, which sees the error and
 * the socket and nothing else: the gateway, the path and the event below are
 * `SocketContext`, which only the chain is given.
 *
 * It rethrows, always - answering the frame would leave the caller waiting on an ack
 * the handler never sent. That is {@link SocketObserver}'s doing: a handler may
 * return a value or a promise, and the base class reports both channels and leaves
 * the outcome exactly as it found it. This used to import dunx's `observe` from
 * `@dunx/http/internal`, which 3.3.0 narrowed to what the framework's own packages
 * import; 3.8.2 made the base class public instead.
 */
export class SocketErrorReporter extends SocketObserver {
  /**
   * dunx silences its `console.error` fallback as soon as any socket middleware
   * exists, whether or not one reports. This is the class that actually does.
   */
  override readonly reportsErrors = true;

  constructor(private readonly logger: Logger) {
    super();
  }

  /**
   * No payload, deliberately: this fires on the frames most likely to be malformed,
   * and a chat body or a bet is the last thing to copy into a log line.
   */
  protected override settled(
    outcome: SocketOutcome,
    frame: SocketFrame,
    ctx: SocketContext,
  ): void {
    if (outcome.ok) return;
    const { error } = outcome;

    const status =
      ErrorMapper.toErrorBody(error)?.status ??
      HttpStatusCode.INTERNAL_SERVER_ERROR;
    const entry = {
      gateway: ctx.gateway,
      path: ctx.path,
      // A lifecycle hook has no event name, and `open` failing is worth the entry.
      event: ctx.event ?? ctx.kind,
      connectionId: frame.socket.data.id,
      status,
      err: error,
    };

    // A rejected cursor is the caller's doing; a socket that cannot reach Redis is
    // ours. Paging on the first trains an operator to ignore the second.
    if (status < HttpStatusCode.INTERNAL_SERVER_ERROR) {
      this.logger.warn('socket handler failed', entry);
      return;
    }
    this.logger.error('socket handler failed', entry);
  }
}
