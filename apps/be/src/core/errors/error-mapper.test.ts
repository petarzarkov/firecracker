import { describe, expect, test } from 'bun:test';
import { HttpError, ValidationError } from '@dunx/http';
import { ErrorMapper } from './error-mapper.js';

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

  test('toErrorBody returns undefined for what it does not own', () => {
    expect(ErrorMapper.toErrorBody(new Error('boom'))).toBeUndefined();
    expect(ErrorMapper.toErrorBody('a string')).toBeUndefined();
  });
});
