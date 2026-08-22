import type { GameBetView, Page } from '@firecracker/contracts';
import { apiFetch } from './api';

/**
 * A request the server refused, carrying the status so a caller can tell a dead
 * session from a server that fell over.
 */
export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`Request failed (${status})`);
    this.name = 'ApiError';
  }
}

/**
 * Whether a body is really the page it claims to be.
 *
 * `as Page<GameBetView>` on a parsed body is an assertion, not a check, and this is
 * the one place it mattered: a 401 answers with `{ error, message, status }`, so the
 * cast produced a "page" whose `data` and `meta` were both `undefined`. The caller
 * then did `setBets(page.data)` and `page.meta.nextCursor` - one poisoned the state
 * and the other threw - and the whole app went white on a stale cookie.
 */
const isPage = (body: unknown): body is Page<GameBetView> =>
  typeof body === 'object' &&
  body !== null &&
  Array.isArray((body as Page<GameBetView>).data) &&
  typeof (body as Page<GameBetView>).meta === 'object' &&
  (body as Page<GameBetView>).meta !== null;

/**
 * One page of the caller's own bets.
 *
 * Throws rather than returning a half-page: there is no useful partial answer here,
 * and a caller that has to check two fields before trusting a result is a caller
 * that will forget to.
 */
export const fetchMyBets = async (
  take: number,
  cursor?: string | undefined,
): Promise<Page<GameBetView>> => {
  const params = new URLSearchParams({ take: String(take) });
  if (cursor !== undefined && cursor !== '') params.set('cursor', cursor);

  const response = await apiFetch(`/api/game/my-bets?${params}`);
  if (!response.ok) throw new ApiError(response.status);

  const body: unknown = await response.json();
  if (!isPage(body)) throw new ApiError(response.status);
  return body;
};
