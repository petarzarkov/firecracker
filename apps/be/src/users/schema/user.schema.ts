import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import {
  createdAt,
  timestampMs,
  updatedAt,
  uuidPk,
} from '../../infra/db/columns.js';
import { UserRole } from '@firecracker/contracts';

/**
 * The roles, from `@firecracker/contracts` - the client gates admin UI on the
 * same values `@Roles()` reads here.
 */
export { UserRole } from '@firecracker/contracts';

/**
 * Better Auth's `user` model, and the app's users table - one table, not two.
 *
 * `@dunx/auth` ships **no** schema: better-auth's tables are better-auth's, they
 * change with its plugins, and its own CLI generates them
 * (`bunx @better-auth/cli generate`). What is here is that output, reconciled
 * with the columns this app already had, and the field *keys* are what the
 * drizzle adapter matches on - the snake-case column names beside them are free
 * to differ.
 *
 * `role`, `banned`, `banReason` and `banExpires` come from the `admin()` plugin,
 * and `role` is what `@Roles()` reads through `SessionGuard`. `isAnonymous` comes
 * from `anonymous()`, which is what "Try Demo" signs in through.
 */
export const users = sqliteTable(
  'user',
  {
    id: uuidPk(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' })
      .notNull()
      .default(false),
    name: text('name').notNull(),
    image: text('image'),
    role: text('role', { enum: [UserRole.ADMIN, UserRole.USER] })
      .notNull()
      .default(UserRole.USER),
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
    /**
     * From the `anonymous()` plugin: a "Try Demo" player. The row is real and so
     * is its wallet - what it lacks is a credential, so it cannot sign in again
     * and is lost when the token is. Linking it to a real sign-up is the plugin's
     * `onLinkAccount`, which this app does not implement yet.
     */
    isAnonymous: integer('is_anonymous', { mode: 'boolean' })
      .notNull()
      .default(false),
    banReason: text('ban_reason'),
    banExpires: timestampMs('ban_expires'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('UQ_user_email').on(table.email)],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
