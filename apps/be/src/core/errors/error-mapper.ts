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
    /**
     * `@dunx/infra/pagination` raises `AppError` rather than `HttpError` on purpose,
     * so it need not depend on the web layer - which makes placing them this
     * function's job. The message passes through: neither names a column or a table.
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

  /** `bun:sqlite` constraint codes, as the status a client can act on. */
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
