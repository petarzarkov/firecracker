import { Logger } from '@dunx/core';
import { JobHandler } from '@dunx/infra/queue';
import type { Job } from 'bullmq';
import { AppConfigService } from '../../config/app.config.service.js';
import { EventsPublisher } from '../events/events.publisher.js';
import {
  EVENTS,
  JOBS,
  NotificationKind,
  publishSocket,
  QUEUES,
  TOPICS,
  Topics,
  type PasswordResetJob,
  type UserBannedJob,
  type UserRegisteredJob,
} from '../events/events.js';
import { EmailService } from '../email/email.service.js';
import { AccountSuspendedEmail } from '../email/templates/account-suspended-email.js';
import { PasswordResetEmail } from '../email/templates/password-reset-email.js';
import { WelcomeEmail } from '../email/templates/welcome-email.js';

/**
 * A job handler is a method with a decorator and nothing else - no class decorator,
 * no `@Processor`, no queue token, no registry. `WorkerFactory` finds it by walking
 * the prototypes of the classes already in `providers`, which is the same
 * marker-plus-scan the route and gateway discovery use.
 */
export class NotificationJobs {
  constructor(
    private readonly email: EmailService,
    private readonly events: EventsPublisher,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  @JobHandler({
    queue: QUEUES.NOTIFICATIONS,
    background: true,
    name: JOBS.USER_REGISTERED,
  })
  async registered(job: Job<UserRegisteredJob>): Promise<{ notified: string }> {
    const { userId, email, name } = job.data;

    // The component is *called*, not written as JSX, so this handler stays a `.ts`
    // file - the templates are the only `.tsx` in the app. They hold no state and
    // no hooks, so an element built this way renders identically.
    await this.email.send({
      to: email,
      subject: `Welcome to Firecracker, ${name}!`,
      template: WelcomeEmail({
        name,
        webUrl: this.config.get('app').webUrl,
      }),
    });

    // Two topics: the user's own, and the admin room. Written by the worker
    // process, so a browser seeing this is proof the frame crossed processes.
    //
    // The text is written here rather than derived in the browser from a job name:
    // `JOBS.USER_REGISTERED` is how this process talks to itself, and a client that
    // switched on it would be reading the queue's vocabulary off the wire.
    publishSocket(this.events, Topics.user(userId), EVENTS.NOTIFICATION, {
      kind: NotificationKind.USER_REGISTERED,
      title: 'Welcome to Firecracker',
      message: `Your account is ready, ${name}.`,
    });
    publishSocket(this.events, TOPICS.ADMINS, EVENTS.NOTIFICATION, {
      kind: NotificationKind.USER_REGISTERED,
      title: 'A player signed up',
      message: `${email} joined.`,
    });

    this.logger.debug('handled user.registered', { userId });
    return { notified: userId };
  }

  /**
   * The password-reset link, sent off the request thread.
   *
   * On the queue rather than inline in better-auth's `sendResetPassword` because
   * that runs inside the HTTP request: a slow mail provider would otherwise hold
   * the response open, and a failing one would turn "we sent you an email" into a
   * 500 telling an attacker the address exists.
   *
   * No socket frame goes with it, unlike the jobs either side. A reset is
   * requested by someone who cannot sign in, so there is no session to notify.
   */
  @JobHandler({
    queue: QUEUES.NOTIFICATIONS,
    background: true,
    name: JOBS.PASSWORD_RESET,
  })
  async passwordReset(job: Job<PasswordResetJob>): Promise<{ sent: string }> {
    const { userId, email, name, url } = job.data;

    await this.email.send({
      to: email,
      subject: 'Reset your Firecracker password',
      template: PasswordResetEmail({ name, resetUrl: url }),
    });

    this.logger.debug('handled user.password-reset', { userId });
    return { sent: email };
  }

  @JobHandler({
    queue: QUEUES.NOTIFICATIONS,
    background: true,
    name: JOBS.USER_BANNED,
  })
  async banned(job: Job<UserBannedJob>): Promise<{ notified: string }> {
    const { userId, email, name, reason } = job.data;

    await this.email.send({
      to: email,
      subject: 'Your Firecracker account has been suspended',
      template: AccountSuspendedEmail({ name, reason }),
    });

    publishSocket(this.events, TOPICS.ADMINS, EVENTS.NOTIFICATION, {
      kind: NotificationKind.USER_BANNED,
      title: 'An account was suspended',
      message: `${email}: ${reason}`,
    });

    return { notified: userId };
  }
}
