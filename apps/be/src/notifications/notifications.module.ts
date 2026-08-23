import { Module } from '@dunx/core';
import { EmailService } from './email/email.service.js';
import { NotificationJobs } from './handlers/notification.jobs.js';
import { SlackService } from './slack/slack.service.js';

/**
 * Email and the jobs that send it. The `EventsPublisher` binding is
 * `EventsPublisherModule`'s and the socket is `GameGateway`'s; neither is here.
 *
 * No `HttpModule`. Email went through `@dunx/http/client` while it was a webhook
 * `POST`; Resend brings its own transport, and the unnamed `HttpService` this used
 * to bind is gone with it - which is why `AIModule` keeps binding a *named* one.
 *
 * Decorated, because there is nothing for a caller to vary: `AppModule` and
 * `JobsModule` both name it with no arguments, so a factory would buy nothing but
 * the chance of two scopes.
 */
@Module({
  providers: [EmailService, NotificationJobs, SlackService],
})
export class NotificationsModule {}
