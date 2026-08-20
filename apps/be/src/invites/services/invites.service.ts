import { Auth } from '@dunx/auth';
import { Logger } from '@dunx/core';
import { HttpError, HttpStatusCode } from '@dunx/http';
import { JobPublisher } from '@dunx/infra/queue';
import type { Page } from '@dunx/infra/pagination';
import { Cron, CronExpression } from '@dunx/infra/schedule';
import { AppConfigService } from '../../config/app.config.service.js';
import { JOBS, QUEUES } from '../../notifications/events/events.js';
import { UsersRepository } from '../../users/repos/users.repository.js';
import { UserRole } from '../../users/schema/user.schema.js';
import {
  InvitesRepository,
  type ListInvitesFilters,
} from '../repos/invites.repository.js';
import { InviteStatus, type InviteRow } from '../schema/invite.schema.js';

/** How long an invitation stays usable. The NestJS version's seven days. */
const VALID_FOR_MS = 7 * 24 * 60 * 60 * 1000;

export class InvitesService {
  constructor(
    private readonly invites: InvitesRepository,
    private readonly users: UsersRepository,
    private readonly auth: Auth,
    private readonly jobs: JobPublisher,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  /**
   * 32 bytes from the platform CSPRNG.
   *
   * Deliberately **not** `@arkv/rng`, for the same reason the round's server seed
   * is not: this value is a credential, and every algorithm that package offers is
   * a non-cryptographic PRNG whose state is recoverable from its outputs. A
   * predictable invite code is an account on somebody else's platform.
   */
  #code(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString('hex');
  }

  /**
   * Invite an address, or refresh the invitation it already has.
   *
   * Re-inviting is an update rather than a second row - `UQ_invite_email` makes
   * that structural - which matches the old behaviour and avoids the state where
   * one person holds two live codes and nobody knows which was meant.
   */
  async invite(email: string, role: UserRole): Promise<InviteRow> {
    if (this.users.findByEmail(email) !== undefined) {
      throw new HttpError(
        HttpStatusCode.CONFLICT,
        `${email} already has an account`,
      );
    }

    const expiresAt = new Date(Date.now() + VALID_FOR_MS);
    const code = this.#code();
    const existing = this.invites.findByEmail(email);

    const invite =
      existing === undefined
        ? this.invites.create({
            email,
            code,
            role,
            expiresAt,
            status: InviteStatus.PENDING,
          })
        : this.invites.update(existing.id, {
            code,
            role,
            expiresAt,
            status: InviteStatus.PENDING,
            acceptedBy: null,
          });

    if (invite === undefined) {
      throw new HttpError(
        HttpStatusCode.INTERNAL_SERVER_ERROR,
        'The invitation could not be saved',
      );
    }

    await this.#sendEmail(invite);
    this.logger.info('invited a user', { email, role });
    return invite;
  }

  /**
   * Redeem a code: create the account it was issued for, at the role it granted.
   *
   * The **email comes off the invite**, never off the request. Taking it from the
   * caller would let anyone holding a code create an account for any address, and
   * an invitation is to a person rather than to whoever has the link.
   */
  async accept(input: {
    code: string;
    password: string;
    name?: string | undefined;
    image?: string | undefined;
  }): Promise<{ email: string; role: UserRole }> {
    const invite = this.invites.findUsableByCode(input.code, new Date());
    if (invite === undefined) {
      // One message for "wrong", "used" and "expired": distinguishing them tells
      // somebody probing codes which of their guesses was once real.
      throw new HttpError(
        HttpStatusCode.BAD_REQUEST,
        'That invitation is not valid',
      );
    }

    const created = await this.auth.api.signUpEmail({
      body: {
        email: invite.email,
        password: input.password,
        name: input.name ?? invite.email.split('@')[0] ?? invite.email,
        ...(input.image === undefined ? {} : { image: input.image }),
      },
    });

    // Claimed *after* the account exists, and conditionally on still being
    // pending, so a failed sign-up leaves the invitation usable and two callers
    // racing one code produce one account.
    const claimed = this.invites.accept(invite.id, created.user.id);
    if (claimed === undefined) {
      throw new HttpError(
        HttpStatusCode.CONFLICT,
        'That invitation was just used',
      );
    }

    /**
     * The role is applied **after** sign-up by updating the row, which is what
     * `UsersService.create` does and for the same reason: the `admin()` plugin's
     * sign-up always writes `user`, so an invitation granting `admin` has to say
     * so afterwards.
     */
    if (invite.role !== UserRole.USER) {
      this.users.update(created.user.id, { role: invite.role });
    }

    this.logger.info('invitation accepted', {
      email: invite.email,
      role: invite.role,
    });
    return { email: invite.email, role: invite.role };
  }

  list(filters: ListInvitesFilters): Promise<Page<InviteRow>> {
    return this.invites.list(filters);
  }

  /**
   * Flips `PENDING` invitations past their expiry to `EXPIRED`.
   *
   * This ran inside `list()`, which made a read path take SQLite's single writer lock
   * and only corrected the table when an administrator opened the page.
   *
   * Bookkeeping rather than enforcement - `accept()` refuses an expired invitation on
   * its own `expiresAt`, not on this column - which is why it can be a schedule at all.
   * `@Cron` over `@Interval` because "on the hour" is a cadence an operator can reason
   * about, where "every 3600000 ms since boot" drifts with every deploy.
   */
  @Cron(CronExpression.HOURLY)
  expireStale(): { expired: number } {
    const expired = this.invites.expireStale(new Date());
    if (expired > 0) this.logger.info('expired stale invitations', { expired });
    return { expired };
  }

  /**
   * The email, on the queue.
   *
   * Off the request thread for the same reason the password reset is: a slow mail
   * provider must not hold the admin's response open, and a failing one must not
   * turn a created invitation into a 500 that suggests it was not created.
   */
  async #sendEmail(invite: InviteRow): Promise<void> {
    const url = `${this.config.get('auth').baseUrl}/invite?code=${invite.code}`;
    await this.jobs
      .publish(QUEUES.NOTIFICATIONS, JOBS.USER_INVITED, {
        email: invite.email,
        role: invite.role,
        url,
        expiresAt: invite.expiresAt.toISOString(),
      })
      .catch((error: unknown) =>
        // No `url`: the invite code grants account creation at the invited role.
        this.logger.warn('invitation email could not be queued', {
          email: invite.email,
          reason: (error as Error).message,
        }),
      );
  }
}
