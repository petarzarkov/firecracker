import type { SyncDatabase, SyncTransaction } from '@dunx/infra/db';
import type * as schema from './schema.js';

/** Here rather than in `schema.js`, which is the barrel and would import itself. */
export type AppSchema = typeof schema;

/**
 * The injected drizzle handle. **Never the head of a constructor annotation**:
 * `@dunx/transform` emits an annotation's head in a value position, and this is a
 * type alias, so `db: Db` records `{ unresolved: "db: Db" }` and fails at *boot*.
 * A constructor writes `db: SyncDatabase<AppSchema>`; everything else writes `Db`.
 */
export type Db = SyncDatabase<AppSchema>;

/**
 * Either handle a repository may be given. They are not assignable to each other -
 * drizzle's `SQLiteTransaction` lacks the `synchronous` marker - but both expose
 * the query builder, which is all a repository touches.
 */
export type DbHandle = Db | SyncTransaction<AppSchema>;

/** The one place the unavoidable handle-to-token cast lives. */
export class Tx {
  static asHandle(handle: DbHandle): Db {
    return handle as unknown as Db;
  }
}
