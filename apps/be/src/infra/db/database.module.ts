import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DynamicModule } from '@dunx/core';
import {
  DbConnection,
  DbModule,
  SqliteConnection,
  SyncDatabase,
  SyncSqliteOptions,
} from '@dunx/infra/db';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { AppConfigService } from '../../config/app.config.service.js';
import * as schema from './schema.js';

export const MIGRATIONS_FOLDER = join(import.meta.dir, 'migrations');

/**
 * Applies the drizzle-kit migrations in the constructor, so the schema is current
 * before anything else in the graph is built. `bun:sqlite` is synchronous, so there
 * is nothing to await and no boot phase to coordinate.
 *
 * dunx settles every async factory before the first constructor runs, which is what
 * makes it safe to assume the connection is already open here.
 */
export class DatabaseBootstrap {
  constructor(
    private readonly connection: DbConnection<SyncDatabase<typeof schema>>,
  ) {
    if (!(this.connection instanceof SqliteConnection)) {
      throw new TypeError('DatabaseBootstrap expects the bun:sqlite backend.');
    }

    migrate(this.connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
  }

  /** The raw `bun:sqlite` handle, for health probes and `BEGIN IMMEDIATE`. */
  get raw(): SqliteConnection<
    typeof schema,
    SyncDatabase<typeof schema>
  >['raw'] {
    return (
      this.connection as SqliteConnection<
        typeof schema,
        SyncDatabase<typeof schema>
      >
    ).raw;
  }
}

/**
 * **`global: true`**, like every module under `infra/`. There is exactly one
 * database in this app, `foundation()` builds it once, and auth, users, the game
 * and the health probe all read it - so making each of them import a reference they
 * cannot construct for themselves would be ceremony with no boundary behind it.
 *
 * The alternative is worse than verbose, it is wrong: `DbModule.forRootAsync()`
 * returns a new object per call, so a feature module calling it again would be a
 * second scope with a second SQLite connection.
 *
 * ## The pragmas are the concurrency design
 *
 * This app runs **two processes** against one database file - the web process and
 * the worker - which is the same shape the Postgres version had, minus the server.
 * Three of these four pragmas are what make that safe, and they replace what
 * `pg_try_advisory_xact_lock` was doing:
 *
 *  - **`busy_timeout` is first, and the order is not cosmetic.** SQLite allows a
 *    single writer, and without a timeout the loser of a race gets `SQLITE_BUSY`
 *    immediately - which in a bet path is a player told "please try again"
 *    because a cleanup job happened to be writing. It has to be set **before**
 *    `journal_mode`, because switching journal mode itself takes a lock: with
 *    this pragma third, starting the web process and the worker together against
 *    a fresh database crashed whichever lost, at boot:
 *
 *        SQLiteError: database is locked  (SQLITE_BUSY)
 *          at openDriver (@dunx/infra/src/db/sqlite/options.ts)
 *
 *    Every pragma after the failing one is also never applied, so the process
 *    that *did* start could be left without WAL. Timeout first.
 *  - `journal_mode = WAL` lets the web process read while the worker writes.
 *    Without it a settling round blocks every `SELECT` in the tick loop.
 *  - `synchronous = NORMAL` is the documented WAL pairing: durable across a process
 *    crash, which is the failure this app actually has, and not across a power cut,
 *    which for round history is an acceptable trade for the fsync.
 *
 * `foreign_keys = ON` is not concurrency, it is SQLite defaulting to off and every
 * `references()` in the schema being decorative until it is set.
 */
export class DatabaseModule {
  static forRoot(): DynamicModule {
    const db = DbModule.forRootAsync(SyncDatabase, {
      useFactory: (config: AppConfigService) => {
        const settings = config.get('db');
        if (settings.sqlitePath !== ':memory:') {
          mkdirSync(dirname(settings.sqlitePath), { recursive: true });
        }
        return new SyncSqliteOptions({
          schema,
          filename: settings.sqlitePath,
          // Order matters - see the note above. `busy_timeout` first.
          pragmas: [
            `busy_timeout = ${settings.busyTimeoutMs}`,
            'journal_mode = WAL',
            'foreign_keys = ON',
            'synchronous = NORMAL',
          ],
        });
      },
      inject: [AppConfigService] as const,
    });

    return {
      module: DatabaseModule,
      global: true,
      imports: [db],
      providers: [DatabaseBootstrap],
      // The reference, not a token list: re-exporting the module hands on whatever
      // `DbModule` exports - `DbConnection`, the drizzle handle - without this
      // module having to restate a list that is not its own.
      exports: [db, DatabaseBootstrap],
    };
  }
}
