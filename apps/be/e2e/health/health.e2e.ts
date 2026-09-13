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

  /**
   * W3C Trace Context, since dunx 3.2.0. `x-request-id` and its `randomUUID` are
   * gone: the response header is `traceresponse`, the request one is
   * `traceparent`, and the log lines carry `traceId`/`spanId`/`traceFlags` where
   * they used to carry `requestId`.
   */
  test('a logged response carries a trace', async () => {
    const { api } = getTestContext();
    const { headers } = await api.json('service/config');
    expect(headers.get('traceresponse')).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
    );
  });

  /**
   * The **trace** is adopted, not the span: this server mints its own span and
   * names the caller's as its parent, so a caller that got its own id back would
   * be looking at a hop that logged nothing.
   */
  test('an inbound traceparent is continued, not echoed', async () => {
    const { api } = getTestContext();
    const traceId = 'a'.repeat(32);
    const spanId = 'b'.repeat(16);
    const response = await api.raw('service/config', {
      headers: { traceparent: `00-${traceId}-${spanId}-01` },
    });

    const traced = response.headers.get('traceresponse');
    expect(traced).toStartWith(`00-${traceId}-`);
    expect(traced).not.toContain(spanId);
    // The sampling decision is the caller's and is forwarded unchanged, so a
    // trace an upstream sampler declined is not re-sampled at this hop.
    expect(traced).toEndWith('-01');
  });

  /**
   * A path in `requestLogging.ignore` skips the trace along with its log line, so
   * everything the handler logs is uncorrelated. `correlateIgnored: true` buys the
   * correlation back for ~2.2 us a request. Both probes are ignored, per
   * `#probePaths`.
   */
  test('KNOWN GAP: an ignored path gets no trace', async () => {
    const { api } = getTestContext();
    const { headers } = await api.json('health/live');
    expect(headers.get('traceresponse')).toBeNull();
  });
});
