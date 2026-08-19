import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Columns } from '../../infra/db/columns.js';

/**
 * Better Auth's `verification` model: single-use values for email verification
 * and password resets.
 */
export const verifications = sqliteTable(
  'verification',
  {
    id: Columns.uuidPk(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: Columns.timestampMs('expires_at').notNull(),
    createdAt: Columns.createdAt(),
    updatedAt: Columns.updatedAt(),
  },
  (table) => [index('verification_identifier_index').on(table.identifier)],
);

export type VerificationRow = typeof verifications.$inferSelect;
