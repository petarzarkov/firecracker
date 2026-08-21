import { join } from 'node:path';
import { Module } from '@dunx/core';
import { DbConnection, DbModule, SyncDatabase } from '@dunx/infra/db';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { AppConfigService } from '../../config/app.config.service.js';
import { sqliteOptionsFor } from './sqlite.js';
import type { Db } from './tx.js';

export const MIGRATIONS_FOLDER = join(import.meta.dir, 'migrations');

/**
 * Whether the process that forked this one has already migrated **this** database.
 *
 * `JobProcessor` sets `DUNX_JOB_WORKER` before it builds the container, and says in
 * its own source that it does so for "anything that must behave differently off the
 * request path... so a provider can read it in its own constructor" - `QueueRunner`
 * reads the same marker to keep a child from opening its own workers. bullmq forks
 * one child per burst, so without this every burst re-read `__drizzle_migrations`
 * and took a write lock on the one file the game loop is writing to. Idempotent, and
 * unnecessary: a child is only ever forked by a parent that migrated at boot.
 *
 * **`:memory:` is the exception, and it is not academic.** An in-memory database
 * belongs to the process that opened it, so a child's is empty however thoroughly
 * its parent migrated - skipping there would hand a handler a database with no
 * tables. `queues.spec.ts` uses a file for exactly that reason and is the suite that
 * proves this path.
 *
 * The marker is passed in rather than read here so the decision is testable without
 * mutating the environment of every other suite in the process.
 */
export const migratedByParentProcess = (
  jobWorkerMarker: string | undefined,
  sqlitePath: string,
): boolean => jobWorkerMarker === 'true' && sqlitePath !== ':memory:';

/**
 * Applies the drizzle-kit migrations in the constructor, so they are done before
 * anything else in the graph is built. `bun:sqlite` is synchronous, so there is
 * nothing to await and no boot phase to coordinate.
 *
 * dunx settles every async factory before the first constructor runs, which is what
 * makes it safe to assume the connection is already open here.
 */
export class DatabaseBootstrap {
  constructor(connection: DbConnection<Db>, config: AppConfigService) {
    if (
      migratedByParentProcess(
        Bun.env['DUNX_JOB_WORKER'],
        config.get('db').sqlitePath,
      )
    ) {
      return;
    }

    migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
  }
}

/**
 * **`global: true`**, like every module under `infra/`. There is exactly one
 * database in this app, `Foundation.for()` builds it once, and auth, users, the game
 * and the health probe all read it - so making each of them import a reference they
 * cannot construct for themselves would be ceremony with no boundary behind it.
 *
 * **Decorated rather than configured**, because a `forRoot()` returning a new object
 * per call means a second caller gets a second scope and a second SQLite connection.
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
  // `DbModule`, the class: an exported module reference resolves to the configuration
  // imported beside it, so re-exporting hands on whatever that module exports -
  // `DbConnection`, `DbOptions`, the drizzle handle - without restating a list that is
  // not this module's own.
  exports: [DbModule, DatabaseBootstrap],
})
export class DatabaseModule {}
