import type { DynamicModule } from '@dunx/core';
import { HttpModule } from '@dunx/http/client';
import { AppConfigService } from '../config/app.config.service.js';
import { NotificationJobs } from './handlers/notification.jobs.js';
import { EmailService } from './services/email.service.js';
import { SlackService } from './slack/slack.service.js';

/**
 * Email and the jobs that send it.
 *
 * ## Two things left this module
 *
 * The `EventsPublisher` binding moved to `EventsPublisherModule`, because the game
 * publishes socket events too and `forRoot()` returns a fresh scope per call - a
 * second module importing this one to reach the publisher would have got a second
 * binding. And `EventsGateway` was folded into `GameGateway`: dunx mounts a gateway
 * as a route, so two gateway classes would mean two paths and two connections,
 * where socket.io gave the old app one. See `game.gateway.ts`.
 */
export class NotificationsModule {
  static forRoot(): DynamicModule {
    return {
      module: NotificationsModule,
      imports: [
        /**
         * The outbound client `EmailService` posts through.
         *
         * Unnamed, so it binds `HttpService` itself and a service injects that class
         * like any other dependency. `HttpModule` also supports naming a client -
         * `forRootAsync(config, 'email')` binds `httpClient('email')`, a `Token`
         * rather than a class, reached with `inject()` in a field initialiser because
         * a token has no type name for `@dunx/transform` to record. That exists for
         * an app calling several upstreams, and this app calls one. Using it here
         * bought nothing and cost the plain constructor.
         *
         * `forRootAsync` because the timeout comes off validated config, which is the
         * one thing a zero-argument `forRoot` cannot read.
         */
        HttpModule.forRootAsync({
          useFactory: (config: AppConfigService) => ({
            timeoutMs: config.get('email').timeoutMs,
            headers: { 'content-type': 'application/json' },
          }),
          inject: [AppConfigService] as const,
        }),
      ],
      providers: [EmailService, NotificationJobs, SlackService],
    };
  }
}
