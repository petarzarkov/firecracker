import { AppError, ConfigError } from '@dunx/core';
import {
  defaultErrorMapper,
  HttpError,
  HttpStatusCode,
  ValidationError,
  type ErrorMapper as DunxErrorMapper,
} from '@dunx/http';
import { toDatabaseError } from '@dunx/infra/db';

export interface ErrorBody {
  readonly error: string;
  readonly message: string;
  readonly status: number;
  readonly issues?: readonly { message: string; path?: string }[];
}

/**
 * One function passed to `HttpFactory.create`, in place of a stack of exception
 * filters. Anything it does not recognise falls through to `defaultErrorMapper`,
 * which never leaks an unexpected error's message.
 *
 * The envelope is `{ error, message, status }`, with `issues` added when a schema
 * rejected the input. Note `status`, not `statusCode`.
 */
export class ErrorMapper {
  static readonly #STATUS_NAME = new Map<number, string>(
    Object.entries(HttpStatusCode).map(([name, code]) => [code, name]),
  );

  /** An arrow property, not a method: it is passed by reference and would lose `this`. */
  static readonly toResponseBody: DunxErrorMapper = (error, req) => {
    const body = ErrorMapper.toErrorBody(error);
    if (body === undefined) return defaultErrorMapper(error, req);
    /**
     * `HttpError.headers` is part of the status, not an extra - `Retry-After` on a
     * 429, `WWW-Authenticate` on a 401. Replacing dunx's mapper means copying them
     * here, or a 429 says "try again" without saying when.
     */
    const headers = error instanceof HttpError ? error.headers : undefined;
    return Response.json(body, {
      status: body.status,
      ...(headers === undefined ? {} : { headers }),
    });
  };

  static toErrorBody(error: unknown): ErrorBody | undefined {
    if (error instanceof ValidationError) {
      return {
        error: ErrorMapper.nameOf(error.status),
        message: `Invalid ${error.source}`,
        status: error.status,
        issues: error.issues.map((issue) =>
          issue.path === undefined
            ? { message: issue.message }
            : { message: issue.message, path: issue.path },
        ),
      };
    }
    if (error instanceof HttpError) {
      return {
        error: ErrorMapper.nameOf(error.status),
        message: error.message,
        status: error.status,
      };
    }
    if (error instanceof ConfigError) {
      return {
        error: ErrorMapper.nameOf(HttpStatusCode.INTERNAL_SERVER_ERROR),
        message: 'Configuration error',
        status: HttpStatusCode.INTERNAL_SERVER_ERROR,
      };
    }
    /**
     * Anything outside the web layer that named the status it means.
     *
     * `@dunx/infra` must not import `@dunx/http`, so it cannot raise an
     * `HttpError` - it sets an integer on `AppError` instead, and placing that
     * integer used to be this function's job per error class. It is one branch
     * now: `CursorError` and `PageOptionsError` declare 400, and
     * `ConstraintError` declares 409 for a unique or foreign key and 400 for
     * not-null and check.
     *
     * `toDatabaseError` is what reaches a driver error that never crossed a
     * transaction - a bare `insert()` in a repository. `transaction`,
     * `transactionSync` and `runSeeds` already classify on the way out, so an
     * error from inside one arrives classified and passes through untouched.
     *
     * The message is safe to forward: `ConstraintError`'s is deliberately generic
     * and keeps the driver's own - which names the table and the column - on
     * `cause`, where it is logged rather than sent.
     */
    const declared = toDatabaseError(error);
    if (
      declared instanceof AppError &&
      ErrorMapper.#isStatus(declared.status)
    ) {
      return {
        error: ErrorMapper.nameOf(declared.status),
        message: declared.message,
        status: declared.status,
      };
    }
    return undefined;
  }

  /**
   * A status `Response.json` can actually carry. `AppError.status` is typed by
   * hand in packages that never see a `Response`, so an out-of-range one would
   * throw a `RangeError` from the error path itself. Out of range falls through
   * to `defaultErrorMapper` and its 500.
   */
  static #isStatus(status: number | undefined): status is number {
    return (
      status !== undefined &&
      Number.isInteger(status) &&
      status >= 200 &&
      status <= 599
    );
  }

  static nameOf(status: number): string {
    return ErrorMapper.#STATUS_NAME.get(status) ?? 'INTERNAL_SERVER_ERROR';
  }
}
