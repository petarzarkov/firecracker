import type { SyncDatabase, SyncTransaction } from '@dunx/infra/db';
import type * as schema from './schema.js';

/**
 * The drizzle schema as a type, for the one place a type argument needs to name
 * it. Lives here rather than in `schema.js` because that file is the barrel and
 * would be importing itself.
 */
export type AppSchema = typeof schema;

/**
 * The injected drizzle handle.
 *
 * **Never the head of a constructor annotation.** `@dunx/transform` slices the
 * annotation's head out of the source text and emits it in a value position, and
 * this is a type alias - so `db: Db` records `{ unresolved: "db: Db" }` and the
 * container refuses to build the class, naming it, at boot rather than at
 * typecheck. A constructor writes `db: SyncDatabase<AppSchema>`; everything else -
 * return types, type arguments, generic constraints - writes `Db`. Type
 * *arguments* are erased before the transform looks, which is why `AppSchema` is
 * safe in that position.
 */
export type Db = SyncDatabase<AppSchema>;

/**
 * The handle a repository actually needs.
 *
 * Two different things get passed to a repository: the injected `SyncDatabase`,
 * and the transaction handle `transactionSync` hands its callback. They are not
 * assignable to each other - drizzle's `SQLiteTransaction` has no `synchronous`
 * property and `SyncDatabase` requires one - but both expose the same query
 * builder, which is all a repository here touches.
 */
export type DbHandle = Db | SyncTransaction<AppSchema>;

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
export class Tx {
  static asHandle(handle: DbHandle): Db {
    // `as unknown as` because drizzle's transaction handle genuinely lacks
    // `SyncDatabase`'s marker property. The builder surface is identical, which is
    // the whole of what a repository uses.
    return handle as unknown as Db;
  }
}
