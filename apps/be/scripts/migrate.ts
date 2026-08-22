/**
 * Applies the drizzle-kit migrations without booting the app.
 *
 * The app applies them itself on every boot (`DatabaseBootstrap`), which is what
 * makes a fresh container work with no init step. This exists for the case where
 * you want to migrate a database the app is not about to open.
 */
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { MIGRATIONS_FOLDER } from '../src/infra/db/database.module.js';
import { openSqliteSync } from '../src/infra/db/sqlite.js';

const filename = Bun.env['SQLITE_DB_PATH'] ?? './data/app.db';

// `openSqliteSync()` is the synchronous mode's own escape hatch: no container, no
// await, and the connection is a real one rather than a fixture. It is shared with
// `DatabaseModule` so a script cannot open the file on weaker pragmas than the app
// does - migrating a database a running app holds is exactly the write that needs
// `busy_timeout`.
const connection = openSqliteSync({ filename });

migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
connection.closeSync();

console.log(`migrated ${filename}`);
