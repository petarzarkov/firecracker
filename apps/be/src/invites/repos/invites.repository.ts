import { and, eq, gt, inArray, lt, type SQL } from 'drizzle-orm';
import { SyncDatabase } from '@dunx/infra/db';
import { paginate, type Page, type PageOptions } from '@dunx/infra/pagination';
import * as schema from '../../infra/db/schema.js';
import {
  invites,
  InviteStatus,
  type InviteRow,
  type NewInviteRow,
} from '../schema/invite.schema.js';

export interface ListInvitesFilters extends PageOptions {
  readonly statuses?: readonly InviteStatus[] | undefined;
}

export class InvitesRepository {
  constructor(private readonly db: SyncDatabase<typeof schema>) {}

  findByEmail(email: string): InviteRow | undefined {
    return this.db.select().from(invites).where(eq(invites.email, email)).get();
  }

  /**
   * The one lookup that authenticates: a **pending, unexpired** invite for this
   * code. Status and expiry are in the `WHERE` rather than checked afterwards, so
   * there is no window in which a caller reads a row and then decides.
   */
  findUsableByCode(code: string, now: Date): InviteRow | undefined {
    return this.db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.code, code),
          eq(invites.status, InviteStatus.PENDING),
          gt(invites.expiresAt, now),
        ),
      )
      .get();
  }

  create(values: NewInviteRow): InviteRow {
    return this.db.insert(invites).values(values).returning().get();
  }

  update(
    id: string,
    values: { [K in keyof NewInviteRow]?: NewInviteRow[K] | undefined },
  ): InviteRow | undefined {
    return this.db
      .update(invites)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(invites.id, id))
      .returning()
      .get();
  }

  /**
   * Claim an invite, conditional on it still being pending.
   *
   * The status guard is what stops two people racing the same code into two
   * accounts: the loser updates no rows and gets `undefined`.
   */
  accept(id: string, userId: string): InviteRow | undefined {
    return this.db
      .update(invites)
      .set({
        status: InviteStatus.ACCEPTED,
        acceptedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(invites.id, id), eq(invites.status, InviteStatus.PENDING)))
      .returning()
      .get();
  }

  /** Mark everything past its expiry, so a listing tells the truth. */
  expireStale(now: Date): number {
    return this.db
      .update(invites)
      .set({ status: InviteStatus.EXPIRED, updatedAt: new Date() })
      .where(
        and(
          eq(invites.status, InviteStatus.PENDING),
          lt(invites.expiresAt, now),
        ),
      )
      .returning()
      .all().length;
  }

  list(filters: ListInvitesFilters): Promise<Page<InviteRow>> {
    const clauses: SQL[] = [];
    if (filters.statuses !== undefined && filters.statuses.length > 0) {
      clauses.push(inArray(invites.status, [...filters.statuses]));
    }

    return paginate<typeof invites, InviteRow>({
      db: this.db,
      table: invites,
      options: filters,
      orderBy: 'createdAt',
      where: clauses.length === 0 ? undefined : and(...clauses),
    });
  }
}
