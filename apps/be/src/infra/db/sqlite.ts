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
 * The pragmas, in the order that matters. Two processes share this file - the
 * server and a bullmq sandbox child - and three of the four are what make that safe.
 *
 * **`busy_timeout` must be first.** Switching `journal_mode` itself takes a lock, so
 * with the timeout third, two processes starting together against a fresh database
 * crashed whichever lost with `SQLITE_BUSY` - and every pragma after the failing one
 * is skipped, leaving the survivor without WAL.
 *
 * `WAL` lets one process read while the other writes; `synchronous = NORMAL` is its
 * documented pairing, durable across a process crash but not a power cut.
 * `foreign_keys = ON` is not concurrency - SQLite defaults it off, which makes every
 * `references()` in the schema decorative.
 */
const pragmasFor = (busyTimeoutMs: number): readonly string[] => [
  `busy_timeout = ${busyTimeoutMs}`,
  'journal_mode = WAL',
  'foreign_keys = ON',
  'synchronous = NORMAL',
];

/**
 * The validated default, not a second copy of `5_000`. A script boots no config tree
 * - `EnvConfig.validate` would demand `API_PORT` - so it reads the one variable it
 * needs through the schema that states what it means.
 */
const busyTimeoutFromEnv = (): number =>
  dbVarsSchema.pick({ DB_BUSY_TIMEOUT_MS: true }).parse(Bun.env)
    .DB_BUSY_TIMEOUT_MS;

/**
 * How this app opens its database file, wherever it is opened from - one function
 * so a script cannot open it on weaker pragmas than the app, which is how
 * `bun run mig:run` against a running server used to fail on `SQLITE_BUSY`.
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
