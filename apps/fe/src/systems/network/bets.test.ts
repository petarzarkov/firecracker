import { afterEach, describe, expect, test } from 'bun:test';
import { ApiError, fetchMyBets } from './bets';

/**
 * The white screen this file exists to prevent.
 *
 * "MY BETS" is gated on a **persisted** user, so a browser holding a cookie the
 * server no longer accepts still mounts the panel and asks. The old reader cast the
 * parsed body to `Page<GameBetView>` - an assertion, not a check - so a 401's
 * `{ error, message, status }` became a page whose `data` and `meta` were both
 * `undefined`. `setBets(undefined)` poisoned the state and `meta.nextCursor` threw,
 * and React unmounted the whole tree.
 */
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const respond = (status: number, body: unknown): void => {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )) as unknown as typeof fetch;
};

const page = {
  data: [{ id: 'bet-1' }],
  meta: {
    take: 20,
    hasNextPage: false,
    hasPreviousPage: false,
    nextCursor: null,
    previousCursor: null,
  },
};

describe('fetchMyBets', () => {
  test('returns the page when the route answers with one', async () => {
    respond(200, page);
    const result = await fetchMyBets(20);
    expect(result.data).toHaveLength(1);
    expect(result.meta.nextCursor).toBeNull();
  });

  /** The stale cookie. It must throw, so nothing downstream reads `.data`. */
  test('a 401 throws rather than returning a page-shaped error body', async () => {
    respond(401, { error: 'UNAUTHENTICATED', message: 'no', status: 401 });
    expect(fetchMyBets(20)).rejects.toThrow(ApiError);
    await fetchMyBets(20).catch((error: unknown) => {
      expect((error as ApiError).status).toBe(401);
    });
  });

  /**
   * A 200 whose body is not a page is the same class of bug arriving by a different
   * door - a proxy's HTML error page, say - and must not survive as `undefined`
   * fields either.
   */
  test('a 200 that is not a page is refused', async () => {
    respond(200, { unexpected: true });
    expect(fetchMyBets(20)).rejects.toThrow(ApiError);
  });

  test('the cursor is only sent when there is one', async () => {
    const seen: string[] = [];
    globalThis.fetch = ((input: string | URL | Request) => {
      seen.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify(page), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;

    await fetchMyBets(20);
    await fetchMyBets(20, 'abc');
    expect(seen[0]).not.toContain('cursor');
    expect(seen[1]).toContain('cursor=abc');
  });
});
