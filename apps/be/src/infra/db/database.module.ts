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
  imports: [
    DbModule.forRootAsync(SyncDatabase, {
      useFactory: (config: AppConfigService) => {
        const settings = config.get('db');
        return sqliteOptionsFor({
          filename: settings.sqlitePath,
          busyTimeoutMs: settings.busyTimeoutMs,
        });
      },
      inject: [AppConfigService] as const,
    }),
  ],
  providers: [DatabaseBootstrap],
  // `DbModule`, the class: dunx 2.2.0 resolves an exported module reference to the
  // configuration imported beside it, so re-exporting hands on whatever that module
  // exports - `DbConnection`, `DbOptions`, the drizzle handle - without restating a
  // list that is not this module's own. It is what retired the hoisted `const` this
  // file kept so one object could appear in both lists.
  exports: [DbModule, DatabaseBootstrap],
})
export class DatabaseModule {}
