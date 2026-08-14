import type { SyncDatabase, SyncTransaction } from '@dunx/infra/db';
import type * as schema from './schema.js';

/**
 * The handle a repository actually needs.
 *
 * Two different things get passed to a repository: the injected `SyncDatabase`,
 * and the transaction handle `transactionSync` hands its callback. They are not
 * assignable to each other - drizzle's `SQLiteTransaction` has no `synchronous`
 * property and `SyncDatabase` requires one - but both expose the same query
 * builder, which is all a repository here touches.
 */
export type DbHandle =
  | SyncDatabase<typeof schema>
  | SyncTransaction<typeof schema>;

/**
 * A transaction handle, narrowed to the injection token's type.
 *
 * The cast is real and it is here so that it is in exactly one place. A repository
 * declares its constructor parameter as `SyncDatabase` because that is the token
 * `@dunx/transform` records and the container resolves; a transaction handle is
 * structurally the same builder and every method a repository calls exists on it.
 *
 * A `txSync` wrapper used to live beside this, working around `transactionSync`
 * refusing to return an object in `@dunx/infra@2.0.0`. That is fixed in 2.0.1, so
 * services import `transactionSync` directly and only this cast remains.
 */
export const asHandle = (handle: DbHandle): SyncDatabase<typeof schema> =>
  // `as unknown as` because drizzle's transaction handle genuinely lacks
  // `SyncDatabase`'s marker property. The builder surface is identical, which is
  // the whole of what a repository uses.
  handle as unknown as SyncDatabase<typeof schema>;
