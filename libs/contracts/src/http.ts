/**
 * The HTTP responses the client reads, as interfaces.
 *
 * The **schemas** stay on the server. They are zod, they carry `.meta({ id })` for
 * the OpenAPI document, and sharing them would put zod in the browser bundle for
 * the privilege of validating a response this app just sent itself. So these are a
 * parallel declaration - and `apps/be/src/game/dto/game.dto.test.ts` asserts the
 * two are assignable in both directions, which is the part that stops them parting
 * ways.
 *
 * It has already happened once. `PlayerHistory` declared a `crashPoint` on its own
 * row type and rendered `(crashPoint ?? 0).toFixed(2)`; no route had ever sent the
 * field, so every lost bet showed as a crash at zero.
 */
import type { GameBetStatus } from './enums.js';

/** The keyset envelope's metadata. Cursors are opaque - do not parse one. */
export interface PageMeta {
  readonly take: number;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
  /** Pass back as `?cursor=` to read forwards. `null` at the end. */
  readonly nextCursor: string | null;
  /** Pass back with `?direction=backward`. `null` at the start. */
  readonly previousCursor: string | null;
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly meta: PageMeta;
}

/**
 * One of the caller's own bets, as `GET /api/game/my-bets` returns it.
 *
 * `cashedOutAt` and `payoutCents` are `null` rather than absent until the bet
 * settles - the column is nullable and the mapper passes it through. `crashPoint`
 * is genuinely absent instead, and only appears once that round has crashed:
 * `crash_point_x100` is written when the round starts running, so sending it any
 * earlier would hand a player the outcome of a round they still have money in.
 */
export interface GameBetView {
  readonly id: string;
  readonly roundId: string;
  readonly userId: string;
  readonly betAmountCents: number;
  readonly status: GameBetStatus;
  readonly cashedOutAt: number | null;
  readonly payoutCents: number | null;
  readonly crashPoint?: number | undefined;
  readonly isDemo: boolean;
  /** ISO 8601, because that is what survives `JSON.stringify`. */
  readonly createdAt: string;
}

/** `GET /api/profile/avatars/trending`, which is public and never empty. */
export interface TrendingAvatars {
  readonly avatars: readonly string[];
}
