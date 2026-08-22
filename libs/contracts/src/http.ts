/**
 * The HTTP bodies the client reads and the one it writes, as interfaces. The
 * **schemas** stay on the server: they are zod and carry `.meta({ id })` for the
 * OpenAPI document, and sharing them would put zod in the browser bundle. So these
 * are a parallel declaration, and `game.dto.test.ts` asserts the two are assignable
 * both ways - without which `crashPoint` was declared and rendered by a client no
 * route ever sent it to.
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
 * One of the caller's own bets. `cashedOutAt` and `payoutCents` are `null` until it
 * settles, because the columns are nullable; `crashPoint` is genuinely **absent**
 * until that round has crashed, since sending it earlier hands a player the outcome
 * of a round they still have money in.
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

/**
 * One stored object. The client only reads `id`, but the whole row is declared -
 * a partial copy of a response is how a field silently means two things.
 *
 * `thumbnailKey` is `null` until the `media` queue's child has rendered one. Do not
 * wait for it: the avatar route serves the original until it appears.
 */
export interface UploadedFile {
  readonly id: string;
  readonly userId: string;
  readonly key: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly thumbnailKey: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Where a new avatar comes from. A union, so "both" and "neither" cannot be sent:
 * `fileId` is an object the caller uploaded and the server checks they own it,
 * `url` is what the trending grid and the custom-URL field produce.
 */
export type AvatarSource =
  | { readonly fileId: string }
  | { readonly url: string };

/** What `POST /api/profile/avatar` answers: `users.image`, as everything reads it. */
export interface AvatarUpdated {
  readonly picture: string;
}
