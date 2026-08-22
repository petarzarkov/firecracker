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
 * bullmq forks a child per burst, so without this every burst re-read
 * `__drizzle_migrations` and took a write lock on the file the game loop is writing.
 *
 * **`:memory:` is the exception**, and not academically: an in-memory database
 * belongs to the process that opened it, so a child's is empty however thoroughly
 * its parent migrated. `queues.spec.ts` uses a file for that reason.
 */
export const migratedByParentProcess = (
  jobWorkerMarker: string | undefined,
  sqlitePath: string,
): boolean => jobWorkerMarker === 'true' && sqlitePath !== ':memory:';

/**
 * Migrations in the constructor, so they are done before anything else in the graph
 * is built. dunx settles every async factory before the first constructor runs,
 * which is why the connection can be assumed open here.
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
 * `global: true` like every module under `infra/`, and **decorated rather than
 * configured** - a `forRoot()` returns a new object per call, so a second caller
 * would get a second scope and a second SQLite connection. The pragmas are the
 * concurrency design and live in `sqlite.ts`.
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
  // The class: an exported module reference resolves to the configuration imported
  // beside it, so this hands on `DbConnection`, `DbOptions` and the drizzle handle
  // without restating a list that is not this module's own.
  exports: [DbModule, DatabaseBootstrap],
})
export class DatabaseModule {}
