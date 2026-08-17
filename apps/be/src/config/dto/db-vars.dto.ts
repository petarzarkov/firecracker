import { z } from 'zod';

/**
 * SQLite only. The Postgres option went away with the migration off TypeORM: the
 * data layer here is synchronous (`bun:sqlite`, `SyncDatabase`), and that is not a
 * limitation being worked around - it is what makes a bet atomic without a lock
 * service. See `GameBetService` for why.
 */
export const dbVarsSchema = z.object({
  SQLITE_DB_PATH: z.string().default('./data/firecracker.db'),
  /**
   * How long a writer waits for the other process's write to finish before giving
   * up with `SQLITE_BUSY`. The web process and the worker share one file, so this
   * is the difference between a queued write and a player told to try again.
   */
  DB_BUSY_TIMEOUT_MS: z.coerce.number().int().min(0).default(5_000),
});
