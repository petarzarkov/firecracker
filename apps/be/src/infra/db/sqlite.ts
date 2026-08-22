import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SyncSqliteOptions } from '@dunx/infra/db';
import type { SyncSqliteConnection } from '@dunx/infra/db';
import { dbVarsSchema } from '../../config/dto/db-vars.dto.js';
import * as schema from './schema.js';
import type { AppSchema } from './tx.js';

export interface SqliteInit {
  readonly filename: string;
  /** Defaults to `DB_BUSY_TIMEOUT_MS`, through the schema that states the default. */
  readonly busyTimeoutMs?: number;
}

/**
 * The pragmas, in the order that matters.
 *
 * This app runs **two processes** against one database file - the serving process and
 * a bullmq sandbox child. Three of these four are what make that safe:
 *
 *  - **`busy_timeout` is first, and the order is not cosmetic.** SQLite allows a
 *    single writer, and without a timeout the loser of a race gets `SQLITE_BUSY`
 *    immediately - which in a bet path is a player told "please try again" because
 *    a cleanup job happened to be writing. It has to be set **before**
 *    `journal_mode`, because switching journal mode itself takes a lock: with this
 *    pragma third, starting two processes together against a fresh database
 *    crashed whichever lost, at boot:
 *
 *        SQLiteError: database is locked  (SQLITE_BUSY)
 *          at openDriver (@dunx/infra/src/db/sqlite/options.ts)
 *
 *    Every pragma after the failing one is also never applied, so the process that
 *    *did* start could be left without WAL. Timeout first.
 *  - `journal_mode = WAL` lets one process read while the other writes. Without it
 *    a settling round blocks every `SELECT` in the tick loop.
 *  - `synchronous = NORMAL` is the documented WAL pairing: durable across a process
 *    crash, which is the failure this app actually has, and not across a power cut,
 *    which for round history is an acceptable trade for the fsync.
 *
 * `foreign_keys = ON` is not concurrency, it is SQLite defaulting to off and every
 * `references()` in the schema being decorative until it is set.
 */
const pragmasFor = (busyTimeoutMs: number): readonly string[] => [
  `busy_timeout = ${busyTimeoutMs}`,
  'journal_mode = WAL',
  'foreign_keys = ON',
  'synchronous = NORMAL',
];

/**
 * The validated default, not a second copy of `5_000`. A script boots no config
 * tree - `EnvConfig.validate` would demand `API_PORT`, which a script has no use
 * for - so it reads the one variable it needs through the one schema that states
 * what it means.
 */
const busyTimeoutFromEnv = (): number =>
  dbVarsSchema.pick({ DB_BUSY_TIMEOUT_MS: true }).parse(Bun.env)
    .DB_BUSY_TIMEOUT_MS;

/**
 * How this app opens its database file, wherever it is opened from.
 *
 * It is one function because it had been three: `DatabaseModule` set four pragmas
 * in the order above, and `scripts/migrate.ts` and `scripts/seed.ts` each set two
 * of them with **no `busy_timeout` at all** - so `bun run mig:run` against a
 * running app was exactly the `SQLITE_BUSY` failure the list documents. Nobody hit
 * it only because a script is usually run against a stopped app.
 */
export const sqliteOptionsFor = (
  init: SqliteInit,
): SyncSqliteOptions<AppSchema> => {
  // `:memory:` has no directory, and a spec opens nothing else.
  if (init.filename !== ':memory:') {
    mkdirSync(dirname(init.filename), { recursive: true });
  }

  return new SyncSqliteOptions({
    schema,
    filename: init.filename,
    pragmas: pragmasFor(init.busyTimeoutMs ?? busyTimeoutFromEnv()),
  });
};

/** For a script with no container: the same file, opened the same way. */
export const openSqliteSync = (
  init: SqliteInit,
): SyncSqliteConnection<AppSchema> => sqliteOptionsFor(init).openSync();
