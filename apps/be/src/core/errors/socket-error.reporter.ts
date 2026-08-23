import { Logger } from '@dunx/core';
import {
  HttpStatusCode,
  type SocketContext,
  type SocketFrame,
  type SocketMiddleware,
  type SocketNext,
} from '@dunx/http';
// dunx 3.0.0 moved the middleware fold to `/internal` and 3.0.1 dropped the
// deprecated re-export, so this is the only place it lives. The subpath carries no
// stability promise: `observe` is the sync-throw *and* async-reject dance written
// once, and reimplementing it here would be a second copy that silently drifts.
import { observe } from '@dunx/http/internal';
import { ErrorMapper } from './error-mapper.js';

/**
 * What `onError` is on the HTTP side, for the socket.
 *
 * A `SocketMiddleware` and **not** `SocketOptions.onError`, which is the seam that
 * looks right and is not: `onError` is a plain function in the options object
 * `HttpFactory.create` is called with, so it exists before the container and can
 * never reach the app's `Logger`. A middleware is resolved from the container.
 *
 * It rethrows, always - answering the frame would leave the caller waiting on an ack
 * the handler never sent.
 */
export class SocketErrorReporter implements SocketMiddleware {
  /**
   * dunx silences its `console.error` fallback as soon as any socket middleware
   * exists, whether or not one reports. This is the class that actually does.
   */
  readonly reportsErrors = true;

  constructor(private readonly logger: Logger) {}

  handle(frame: SocketFrame, ctx: SocketContext, next: SocketNext): unknown {
    return observe(next, (error) => {
      if (error !== undefined) this.#report(error, frame, ctx);
    });
  }

  /**
   * No payload, deliberately: this fires on the frames most likely to be malformed,
   * and a chat body or a bet is the last thing to copy into a log line.
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

    // A rejected cursor is the caller's doing; a socket that cannot reach Redis is
    // ours. Paging on the first trains an operator to ignore the second.
    if (status < HttpStatusCode.INTERNAL_SERVER_ERROR) {
      this.logger.warn('socket handler failed', entry);
      return;
    }
    this.logger.error('socket handler failed', entry);
  }
}
