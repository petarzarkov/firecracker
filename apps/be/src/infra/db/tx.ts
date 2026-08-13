import { SyncDatabase, transactionSync } from '@dunx/infra/db';
import type { SyncTransaction } from '@dunx/infra/db';
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
 */
export const asHandle = (handle: DbHandle): SyncDatabase<typeof schema> =>
  // `as unknown as` because drizzle's transaction handle genuinely lacks
  // `SyncDatabase`'s marker property. The builder surface is identical, which is
  // the whole of what a repository uses.
  handle as unknown as SyncDatabase<typeof schema>;

/**
 * `transactionSync`, with the return type it should have had.
 *
 * ## Why this wrapper exists
 *
 * `@dunx/infra@2.0.0` constrains the callback's return to `NotThenable`, whose
 * first member is `{ then?: undefined }`. That is a **weak type**, so TypeScript
 * refuses any object with no property in common with it - which is every row:
 *
 *     transactionSync(db, (tx) => tx.insert(bets).values(v).returning().get())
 *     //  Type '{ id: string; … }' is not assignable to type 'NotThenable'.
 *
 * Only primitives compiled, which is why the bug survived - every test in that
 * package returns a `number`. **Fixed upstream**: the constraint moved onto the
 * return type as `NoPromise<T>`, so a promise is still refused and an object is
 * not. Once that ships, delete this file and import `transactionSync` directly;
 * the call sites do not change.
 */
export const txSync = <T>(
  db: SyncDatabase<typeof schema>,
  fn: (tx: SyncTransaction<typeof schema>) => T,
): T =>
  (
    transactionSync as unknown as (
      db: SyncDatabase<typeof schema>,
      fn: (tx: SyncTransaction<typeof schema>) => T,
    ) => T
  )(db, fn);
