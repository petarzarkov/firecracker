import { join } from 'node:path';
import { Module } from '@dunx/core';
import { DbConnection, DbModule, SyncDatabase } from '@dunx/infra/db';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { AppConfigService } from '../../config/app.config.service.js';
import { sqliteOptionsFor } from './sqlite.js';
import type * as schema from './schema.js';

export const MIGRATIONS_FOLDER = join(import.meta.dir, 'migrations');

/**
 * Applies the drizzle-kit migrations in the constructor, so they are done before
 * anything else in the graph is built. `bun:sqlite` is synchronous, so there is
 * nothing to await and no boot phase to coordinate.
 *
 * dunx settles every async factory before the first constructor runs, which is what
 * makes it safe to assume the connection is already open here.
 */
export class DatabaseBootstrap {
  constructor(connection: DbConnection<SyncDatabase<typeof schema>>) {
    migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
  }
}

/**
 * Hoisted to a file-scope `const` so the same reference is both imported and
 * re-exported, and so the decorator below can name it: a `const` is initialised
 * before the decorator runs.
 */
const db = DbModule.forRootAsync(SyncDatabase, {
  useFactory: (config: AppConfigService) => {
    const settings = config.get('db');
    return sqliteOptionsFor({
      filename: settings.sqlitePath,
      busyTimeoutMs: settings.busyTimeoutMs,
    });
  },
  inject: [AppConfigService] as const,
});

/**
 * **`global: true`**, like every module under `infra/`. There is exactly one
 * database in this app, `Foundation.for()` builds it once, and auth, users, the game
 * and the health probe all read it - so making each of them import a reference they
 * cannot construct for themselves would be ceremony with no boundary behind it.
 *
 * **A decorated class rather than a `forRoot()` that took no arguments.** A scope is
 * keyed on the module reference and `forRoot()` returned a new object per call, so a
 * second caller was a second scope with a second SQLite connection. A class is one
 * reference however many modules name it, which is the only shape that dedupes.
 *
 * **The pragmas are the concurrency design**, and they live in `sqlite.ts` with the
 * note that says why their order is not cosmetic - because the two scripts open the
 * same file and had drifted from this list.
 */
@Module({
  global: true,
  imports: [db],
  providers: [DatabaseBootstrap],
  // The reference, not a token list: re-exporting the module hands on whatever
  // `DbModule` exports - `DbConnection`, the drizzle handle - without this
  // module having to restate a list that is not its own.
  exports: [db, DatabaseBootstrap],
})
export class DatabaseModule {}
