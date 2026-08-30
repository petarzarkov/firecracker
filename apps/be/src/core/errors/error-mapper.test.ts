import { describe, expect, test } from 'bun:test';
import { HttpError, ValidationError } from '@dunx/http';
import { PageOptionsError } from '@dunx/infra/pagination';
import { ErrorMapper } from './error-mapper.js';

/**
 * What bun:sqlite raises, as the two fields `toDatabaseError` classifies on. A
 * real violation needs a migrated database; this needs neither, and asserts the
 * same seam - `name` and `code` are all the classifier reads.
 */
class FakeSQLiteError extends Error {
  override readonly name = 'SQLiteError';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const req = new Request('http://localhost/api/users');

describe('ErrorMapper', () => {
  test('an HttpError becomes { error, message, status }', async () => {
    const response = ErrorMapper.toResponseBody(
      new HttpError(404, 'No such user'),
      req,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'NOT_FOUND',
      message: 'No such user',
      status: 404,
    });
  });

  /**
   * `ThrottleGuard` throws its 429 with `Retry-After` and `RateLimit-*` on the
   * error, because a status is not the whole answer. dunx's own `errorMapper`
   * copies them; replacing the mapper means copying them here, and forgetting to
   * is silent - the body is right and the client has nothing to wait on.
   */
  test('an HttpError carries its headers onto the response', () => {
    const response = ErrorMapper.toResponseBody(
      new HttpError(429, 'Rate limit exceeded', {
        headers: { 'retry-after': '42', 'ratelimit-remaining': '0' },
      }),
      req,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(response.headers.get('ratelimit-remaining')).toBe('0');
  });

  test('a ValidationError carries its issues through', async () => {
    const error = new ValidationError('body', [
      { message: 'Invalid email address', path: 'email' },
      { message: 'Required' },
    ]);
    const response = ErrorMapper.toResponseBody(error, req);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'BAD_REQUEST',
      message: 'Invalid body',
      status: 400,
      issues: [
        { message: 'Invalid email address', path: 'email' },
        { message: 'Required' },
      ],
    });
  });

  test('an unrecognised error falls through and leaks nothing', async () => {
    const response = ErrorMapper.toResponseBody(
      new Error('connection string: hunter2'),
      req,
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(body['status']).toBe(500);
  });

  /**
   * The branch that replaced a hand-written table of `SQLITE_CONSTRAINT_*` codes.
   * A repository's bare `insert()` never crosses a transaction, so the driver's
   * own error is what arrives and this mapper is the only thing that classifies it.
   */
  test('a unique violation outside a transaction becomes a 409', async () => {
    const response = ErrorMapper.toResponseBody(
      new FakeSQLiteError(
        'SQLITE_CONSTRAINT_UNIQUE',
        'UNIQUE constraint failed: user.email',
      ),
      req,
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['error']).toBe('CONFLICT');
    // The driver names the table and the column. Neither may reach the caller.
    expect(JSON.stringify(body)).not.toContain('user.email');
  });

  /**
   * `@dunx/infra` sets an integer on `AppError` rather than importing the web
   * layer. Placing it was a branch per error class; it is one branch now, and this
   * is the half of it that never touches a database.
   */
  test('an AppError that named its own status keeps it', async () => {
    const response = ErrorMapper.toResponseBody(
      new PageOptionsError('take must be a positive integer'),
      req,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'BAD_REQUEST',
      message: 'take must be a positive integer',
      status: 400,
    });
  });

  test('a driver error that is not a constraint leaks nothing', async () => {
    const response = ErrorMapper.toResponseBody(
      new FakeSQLiteError('SQLITE_IOERR', 'disk I/O error on /srv/secret.db'),
      req,
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret.db');
  });

  test('toErrorBody returns undefined for what it does not own', () => {
    expect(ErrorMapper.toErrorBody(new Error('boom'))).toBeUndefined();
    expect(ErrorMapper.toErrorBody('a string')).toBeUndefined();
  });
});
