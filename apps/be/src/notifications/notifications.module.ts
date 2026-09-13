import { Module } from '@dunx/core';
import { EmailModule } from '@dunx/infra/email';
import { ReactEmailRenderer } from '@dunx/infra/email/react';
import { ResendTransport } from '@dunx/infra/email/resend';
import { AppConfigService } from '../config/app.config.service.js';
import { NotificationJobs } from './handlers/notification.jobs.js';
import { SlackService } from './slack/slack.service.js';

/**
 * Email and the jobs that send it. The `EventsPublisher` binding is
 * `EventsPublisherModule`'s and the socket is `GameGateway`'s; neither is here.
 *
 * Decorated, because there is nothing for a caller to vary: `AppModule` and
 * `JobsModule` both name it with no arguments, so a factory would buy nothing but
 * the chance of two scopes.
 */
@Module({
  imports: [
    EmailModule.forRootAsync({
      useFactory: (config: AppConfigService) => {
        const { apiKey, sender } = config.get('email');
        return {
          from: sender,
          renderer: new ReactEmailRenderer(),
          /**
           * No key means no transport, which leaves `LogTransport` - the message
           * is logged without its bodies and nothing is sent. A password-reset
           * body carries better-auth's one-time link, so a transport that printed
           * it would turn log access into an account-takeover path.
           *
           * `ResendTransport` refuses an empty key rather than constructing a
           * client that fails per send, which is why this branches here.
           */
          ...(apiKey === undefined
            ? {}
            : { transport: new ResendTransport({ apiKey }) }),
        };
      },
      inject: [AppConfigService] as const,
    }),
  ],
  providers: [NotificationJobs, SlackService],
})
export class NotificationsModule {}
