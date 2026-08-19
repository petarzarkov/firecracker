import { describe, expect, test } from 'bun:test';
import type { HealthReport } from '@dunx/http';
import { getTestContext } from '../setup/context.js';

describe('the health probes against a live server', () => {
  test('liveness needs no credential', async () => {
    const { api } = getTestContext();
    const { status, body } = await api.json<HealthReport>('health/live');
    expect(status).toBe(200);
    expect(body.status).toBe('up');
    expect(body.uptimeMs).toBeGreaterThan(0);
  });

  /**
   * Against the real SQLite **file**, which is what makes these two meaningful:
   * `DatabaseIndicator` does a round trip and `DiskIndicator` measures that file's
   * directory.
   */
  test('readiness reports the real database and volume up', async () => {
    const { api } = getTestContext();
    const { status, body } = await api.json<HealthReport>('health/ready');

    expect(status).toBe(200);
    expect(body.status).toBe('up');
    expect(body.draining).toBe(false);

    const byName = new Map(body.checks.map((check) => [check.name, check]));
    expect(byName.get('database')?.state).toBe('up');
    expect(byName.get('database')?.critical).toBe(true);
    expect(byName.get('disk')?.state).toBe('up');
    expect(byName.get('disk')?.critical).toBe(false);
  });

  test('a logged response carries a request id', async () => {
    const { api } = getTestContext();
    const { headers } = await api.json('service/config');
    expect(headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('an inbound request id is echoed back', async () => {
    const { api } = getTestContext();
    const mine = crypto.randomUUID();
    const response = await api.raw('service/config', {
      headers: { 'x-request-id': mine },
    });
    expect(response.headers.get('x-request-id')).toBe(mine);
  });

  /**
   * `x-request-id` comes from `RequestLoggingMiddleware`, so a path in
   * `requestLogging.ignore` loses correlation as well as its log line - and so does
   * everything the handler logs. Both probes are ignored, per `#probePaths`.
   */
  test('KNOWN GAP: an ignored path gets no request id', async () => {
    const { api } = getTestContext();
    const { headers } = await api.json('health/live');
    expect(headers.get('x-request-id')).toBeNull();
  });
});
