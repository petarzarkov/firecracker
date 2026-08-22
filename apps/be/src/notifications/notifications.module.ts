import { Module } from '@dunx/core';
import { HttpModule } from '@dunx/http/client';
import { AppConfigService } from '../config/app.config.service.js';
import { NotificationJobs } from './handlers/notification.jobs.js';
import { EmailService } from './services/email.service.js';
import { SlackService } from './slack/slack.service.js';

/**
 * The outbound client `EmailService` posts through.
 *
 * Unnamed, so it binds `HttpService` itself and a service injects that class like any
 * other dependency. A *named* client binds `httpClient(name)` instead - a `Token`
 * rather than a class, so it has to be reached with `inject()` in a field
 * initialiser. That is the shape for an app calling several upstreams; this one calls
 * a single webhook.
 *
 * `forRootAsync` because the timeout comes off validated config, which is the one
 * thing a zero-argument `forRoot` cannot read - and it is hoisted to a `const` so
 * the decorator below can name it.
 */
const email = HttpModule.forRootAsync({
  useFactory: (config: AppConfigService) => ({
    timeoutMs: config.get('email').timeoutMs,
    headers: { 'content-type': 'application/json' },
  }),
  inject: [AppConfigService] as const,
});

/**
 * Email and the jobs that send it. The `EventsPublisher` binding is
 * `EventsPublisherModule`'s and the socket is `GameGateway`'s; neither is here.
 *
 * Decorated, because there is nothing for a caller to vary: `AppModule` and
 * `JobsModule` both name it with no arguments, so a factory would buy nothing but the
 * chance of two scopes.
 */
@Module({
  imports: [email],
  providers: [EmailService, NotificationJobs, SlackService],
})
export class NotificationsModule {}
