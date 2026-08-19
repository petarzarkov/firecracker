import type { RouteSchemas } from '@dunx/http';
import { z } from 'zod';
import { Paginated, pageOptionsSchema } from '../../core/pagination.dto.js';
import { UserRole } from '../../users/schema/user.schema.js';
import { InviteStatus } from '../schema/invite.schema.js';

const STATUSES = [
  InviteStatus.PENDING,
  InviteStatus.ACCEPTED,
  InviteStatus.EXPIRED,
] as const;

/**
 * An invitation as an admin sees it.
 *
 * **`code` is not on it.** It is the credential the email carries, and a listing
 * that included it would let anyone who can read the admin screen - or a log line
 * containing the response - accept somebody else's invitation.
 */
export const Invite = z
  .object({
    id: z.uuid(),
    email: z.email(),
    role: z.enum([UserRole.ADMIN, UserRole.USER]),
    status: z.enum(STATUSES),
    expiresAt: z.iso.datetime(),
    acceptedBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Invite', title: 'An invitation to join' });
export type Invite = z.infer<typeof Invite>;

export const PaginatedInvites = Paginated.of(Invite, 'PaginatedInvites');

export const CreateInvite = z
  .object({
    email: z.email(),
    role: z.enum([UserRole.ADMIN, UserRole.USER]).default(UserRole.USER),
  })
  .meta({ id: 'CreateInvite', title: 'Invite somebody' });

/**
 * Redeeming a code.
 *
 * No `email` field, on purpose: the address comes off the invitation. Accepting a
 * caller-supplied one would turn a leaked code into "create an account for any
 * address I like".
 */
export const AcceptInvite = z
  .object({
    code: z.string().min(16).max(128),
    password: z.string().min(8).max(64),
    name: z.string().min(1).max(80).optional(),
    image: z.url().max(500).optional(),
  })
  .meta({ id: 'AcceptInvite', title: 'Redeem an invitation' });

export const listInvites = {
  query: pageOptionsSchema.extend({
    statuses: z
      .string()
      .optional()
      .transform((value) =>
        value === undefined
          ? undefined
          : value
              .split(',')
              .map((part) => part.trim())
              .filter((part): part is InviteStatus =>
                (STATUSES as readonly string[]).includes(part),
              ),
      ),
  }),
} as const satisfies RouteSchemas;

export const createInvite = {
  body: CreateInvite,
} as const satisfies RouteSchemas;
export const acceptInvite = {
  body: AcceptInvite,
} as const satisfies RouteSchemas;
