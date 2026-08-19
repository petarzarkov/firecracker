import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { Columns } from '../../infra/db/columns.js';
import { users } from '../../users/schema/user.schema.js';

/**
 * Better Auth's `session` model. `impersonatedBy` is the `admin()` plugin's.
 *
 * With `secondaryStorage` configured (Redis present) better-auth keeps the live
 * session in Redis and this table is the durable record; with no Redis it is the
 * only store. Either way the shape is the same, which is why nothing here
 * branches on it.
 */
export const sessions = sqliteTable(
  'session',
  {
    id: Columns.uuidPk(),
    expiresAt: Columns.timestampMs('expires_at').notNull(),
    token: text('token').notNull(),
    createdAt: Columns.createdAt(),
    updatedAt: Columns.updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
  },
  (table) => [
    uniqueIndex('UQ_session_token').on(table.token),
    index('session_user_id_index').on(table.userId),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
