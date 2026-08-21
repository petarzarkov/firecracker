import { Logger } from '@dunx/core';
import {
  HttpStatusCode,
  observe,
  type SocketContext,
  type SocketFrame,
  type SocketMiddleware,
  type SocketNext,
} from '@dunx/http';
import { ErrorMapper } from './error-mapper.js';

/**
 * What `onError` is on the HTTP side, for the socket: the one place a handler's
 * exception becomes a structured entry, graded by what the error turned out to be.
 *
 * It is a `SocketMiddleware` and **not** `SocketOptions.onError`, which is the seam
 * that looks right and is not. `onError` is a plain function in the options object
 * `HttpFactory.create` is *called with*, so it exists before the container does and
 * can never reach the app's `Logger` - the best it could do is `console.error`,
 * which is the hole this closes. A middleware is resolved from the container, so it
 * injects the same logger every other line in the process goes through.
 *
 * Without it a socket exception is silent in production. `@dunx/http` replaces its
 * `console.error` default with a no-op as soon as any socket middleware exists, and
 * `SocketLoggingMiddleware`'s own failure entry is configured down to `debug` here so
 * that one failure is not counted twice - so at `LOG_LEVEL=info` nothing else writes.
 *
 * It rethrows, always. Answering the frame instead would leave the caller waiting on
 * an ack the handler never sent, and every handler in this gateway sends its own.
 */
export class SocketErrorReporter implements SocketMiddleware {
  constructor(private readonly logger: Logger) {}

  handle(frame: SocketFrame, ctx: SocketContext, next: SocketNext): unknown {
    return observe(next, (error) => {
      if (error !== undefined) this.#report(error, frame, ctx);
    });
  }

  /**
   * The payload is not in here, deliberately: this fires on the frames most likely
   * to be malformed, and a chat body or a bet is the last thing to copy into a log
   * line because it failed.
   */
  #report(error: unknown, frame: SocketFrame, ctx: SocketContext): void {
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

    // A rejected cursor or a unique violation is the caller's doing, and a socket
    // that cannot reach Redis is ours. Paging on the first would train an operator
    // to ignore the second.
    if (status < HttpStatusCode.INTERNAL_SERVER_ERROR) {
      this.logger.warn('socket handler failed', entry);
      return;
    }
    this.logger.error('socket handler failed', entry);
  }
}
