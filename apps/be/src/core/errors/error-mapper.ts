import { SQLiteError } from 'bun:sqlite';
import { ConfigError } from '@dunx/core';
import {
  defaultErrorMapper,
  HttpError,
  HttpStatusCode,
  ValidationError,
  type ErrorMapper as DunxErrorMapper,
} from '@dunx/http';
import { CursorError, PageOptionsError } from '@dunx/infra/pagination';

export interface ErrorBody {
  readonly error: string;
  readonly message: string;
  readonly status: number;
  readonly issues?: readonly { message: string; path?: string }[];
}

/**
 * dunx's answer to a stack of `@Catch()` exception filters: one function passed to
 * `HttpFactory.create`. Anything it does not recognise falls through to
 * `defaultErrorMapper`, which never leaks an unexpected error's message.
 *
 * The envelope matches the NestJS template's: `{ error, message, status }`, with
 * `issues` added when a schema rejected the input. Note `status`, not `statusCode`.
 *
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
     * `HttpError.headers` is part of the status, not an extra: `Retry-After` and
     * `RateLimit-*` on `ThrottleGuard`'s 429, `WWW-Authenticate` on a 401. dunx's
     * own `errorMapper` copies them, and replacing the mapper means copying them
     * here - a 429 whose body says "try again" and whose headers do not say when
     * is a 429 a client cannot act on.
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
    /**
     * A cursor that did not come from `encodeCursor`, or page options outside their
     * bounds. `@dunx/infra/pagination` raises `AppError` subclasses rather than
     * `HttpError` on purpose - it must not depend on the web layer - so placing them
     * is this function's job, and 400 is the answer for both: the caller sent
     * something it made up.
     *
     * The message is passed through unchanged. Both are written for a client to read
     * and neither names a column, a table or which layer rejected it.
     */
    if (error instanceof CursorError || error instanceof PageOptionsError) {
      return {
        error: ErrorMapper.nameOf(HttpStatusCode.BAD_REQUEST),
        message: error.message,
        status: HttpStatusCode.BAD_REQUEST,
      };
    }
    if (error instanceof SQLiteError) return ErrorMapper.#fromSqlite(error);
    if (error instanceof ConfigError) {
      return {
        error: ErrorMapper.nameOf(HttpStatusCode.INTERNAL_SERVER_ERROR),
        message: 'Configuration error',
        status: HttpStatusCode.INTERNAL_SERVER_ERROR,
      };
    }
    return undefined;
  }

  static nameOf(status: number): string {
    return ErrorMapper.#STATUS_NAME.get(status) ?? 'INTERNAL_SERVER_ERROR';
  }

  /** `bun:sqlite` constraint codes, mapped the way the NestJS filter did. */
  static #fromSqlite(error: SQLiteError): ErrorBody {
    const nameOf = ErrorMapper.nameOf;
    switch (error.code) {
      case 'SQLITE_CONSTRAINT_UNIQUE':
      case 'SQLITE_CONSTRAINT_PRIMARYKEY':
        return {
          error: nameOf(HttpStatusCode.CONFLICT),
          message: 'A record with the provided data already exists',
          status: HttpStatusCode.CONFLICT,
        };
      case 'SQLITE_CONSTRAINT_FOREIGNKEY':
        return {
          error: nameOf(HttpStatusCode.BAD_REQUEST),
          message: 'Invalid reference to related entity',
          status: HttpStatusCode.BAD_REQUEST,
        };
      case 'SQLITE_CONSTRAINT_NOTNULL':
        return {
          error: nameOf(HttpStatusCode.BAD_REQUEST),
          message: 'Required field cannot be empty',
          status: HttpStatusCode.BAD_REQUEST,
        };
      default:
        if (error.code?.startsWith('SQLITE_CONSTRAINT') === true) {
          return {
            error: nameOf(HttpStatusCode.BAD_REQUEST),
            message: 'Data does not meet validation requirements',
            status: HttpStatusCode.BAD_REQUEST,
          };
        }
        return {
          error: nameOf(HttpStatusCode.INTERNAL_SERVER_ERROR),
          message: 'Database operation failed',
          status: HttpStatusCode.INTERNAL_SERVER_ERROR,
        };
    }
  }
}
