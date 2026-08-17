import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { UserRole } from '../../users/schema/user.schema.js';
import {
  createdAt,
  timestampMs,
  updatedAt,
  uuidPk,
} from '../../infra/db/columns.js';

export const InviteStatus = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  EXPIRED: 'expired',
} as const);
export type InviteStatus = (typeof InviteStatus)[keyof typeof InviteStatus];

const STATUSES = [
  InviteStatus.PENDING,
  InviteStatus.ACCEPTED,
  InviteStatus.EXPIRED,
] as const;

/**
 * An invitation to join, and the role it grants.
 *
 * ## The code is the credential
 *
 * `code` is 32 bytes from `crypto.getRandomValues`, and holding it is the whole of
 * the proof that the invitation is yours - so it is unique, it is never listed by
 * the admin route, and it expires. That is also why it is drawn from the platform
 * CSPRNG rather than from `@arkv/rng`: a guessable invite code is an account on
 * somebody else's platform.
 *
 * `email` is unique too, which is what makes re-inviting an address an **update**
 * rather than a second row - matching the NestJS behaviour, where inviting the
 * same person twice refreshes their code instead of leaving two live ones.
 */
export const invites = sqliteTable(
  'invite',
  {
    id: uuidPk(),
    email: text('email').notNull(),
    code: text('code').notNull(),
    role: text('role', { enum: [UserRole.ADMIN, UserRole.USER] })
      .notNull()
      .default(UserRole.USER),
    status: text('status', { enum: STATUSES })
      .notNull()
      .default(InviteStatus.PENDING),
    expiresAt: timestampMs('expires_at').notNull(),
    /** Who accepted it, once somebody has. */
    acceptedBy: text('accepted_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('UQ_invite_email').on(table.email),
    uniqueIndex('UQ_invite_code').on(table.code),
    index('invite_status_index').on(table.status),
  ],
);

export type InviteRow = typeof invites.$inferSelect;
export type NewInviteRow = typeof invites.$inferInsert;
