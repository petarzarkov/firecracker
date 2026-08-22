import { join } from 'node:path';
import { runSeeds } from '@dunx/infra/db';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { MIGRATIONS_FOLDER } from '../src/infra/db/database.module.js';
import { openSqliteSync } from '../src/infra/db/sqlite.js';

const filename = Bun.env['SQLITE_DB_PATH'] ?? './data/app.db';

// The app's own pragmas, in the app's own order: a seed run against a database the
// app has open is a writer racing a writer, and `busy_timeout` is what makes the
// loser wait rather than fail.
const connection = openSqliteSync({ filename });

migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });

const report = await runSeeds(connection.db, {
  dir: join(import.meta.dir, '..', 'src', 'infra', 'db', 'seeds'),
  env: Bun.env['NODE_ENV'] ?? 'development',
});

connection.closeSync();

console.log(
  JSON.stringify(
    {
      applied: report.applied,
      journaled: report.journaled,
      skipped: report.skipped,
    },
    null,
    2,
  ),
);
