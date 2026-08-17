import { Controller, Get, Post, Public, Roles, type Input } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import type { Page } from '@dunx/infra/pagination';
import { UserRole } from '../users/schema/user.schema.js';
import {
  acceptInvite,
  createInvite,
  listInvites,
  type Invite,
} from './dto/invite.dto.js';
import type { InviteRow } from './schema/invite.schema.js';
import { InvitesService } from './services/invites.service.js';

/**
 * Invitations: two admin routes and one public one.
 *
 * The public one is the point of the feature - somebody with a code has, by
 * definition, no account yet, so `@Public()` is not a relaxation but the whole
 * flow. What protects it is the code itself: 32 bytes of CSPRNG, single-use,
 * expiring, and never returned by the listing.
 */
@ApiDoc({ tags: ['invites'], description: 'Invitations to join.' })
@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @ApiDoc({ tags: ['invites'], summary: 'List invitations' })
  @Roles(UserRole.ADMIN)
  @Get('/', listInvites)
  async list(input: Input<typeof listInvites>): Promise<Page<Invite>> {
    const page = await this.invites.list(input.query);
    return { ...page, data: page.data.map(mapInvite) };
  }

  @ApiDoc({ tags: ['invites'], summary: 'Invite somebody by email' })
  @Roles(UserRole.ADMIN)
  @Post('/', createInvite)
  async create(input: Input<typeof createInvite>): Promise<Invite> {
    const { email, role } = input.body;
    return mapInvite(await this.invites.invite(email, role));
  }

  @ApiDoc({
    tags: ['invites'],
    summary: 'Redeem an invitation and create the account',
  })
  @Public()
  @Post('/accept', acceptInvite)
  accept(
    input: Input<typeof acceptInvite>,
  ): Promise<{ email: string; role: string }> {
    return this.invites.accept(input.body);
  }
}

/** Never includes `code` - see the note on the `Invite` schema. */
const mapInvite = (row: InviteRow): Invite => ({
  id: row.id,
  email: row.email,
  role: row.role,
  status: row.status,
  expiresAt: row.expiresAt.toISOString(),
  acceptedBy: row.acceptedBy,
  createdAt: row.createdAt.toISOString(),
});
