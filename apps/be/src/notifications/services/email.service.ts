import { Logger } from '@dunx/core';
import { HttpService } from '@dunx/http/client';
import { AppConfigService } from '../../config/app.config.service.js';

export interface Email {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * The outbound transport, over `@dunx/http/client`.
 *
 * A `POST` to `EMAIL_WEBHOOK_URL` naming no vendor - Resend, Postmark, SES behind a
 * function and an internal relay all accept that shape. With no URL configured it
 * degrades rather than fails, so the queue still demonstrably delivers a job to a
 * worker on a machine with nothing set up.
 *
 * `HttpService` rather than bare `fetch` for the per-attempt timeout, the backoff
 * that honours `Retry-After`, and the request-id propagation that makes the outbound
 * call traceable to the inbound one. Those retries happen *inside one job attempt*,
 * with the queue's three on top: a 503 from the provider is worth two quick retries
 * before spending a whole job attempt on it.
 */
export class EmailService {
  constructor(
    private readonly http: HttpService,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  async send(email: Email): Promise<void> {
    const { webhookUrl, timeoutMs, maxRetries } = this.config.get('email');

    if (webhookUrl === undefined) {
      // Never the body. A password-reset body carries better-auth's one-time link,
      // so logging it turns anyone with log access into an account-takeover path.
      // `LOG_MASK_FIELDS` cannot help: it masks by field name, and a token inside
      // a URL string is not a field.
      this.logger.debug('email not sent, no EMAIL_WEBHOOK_URL configured', {
        to: email.to,
        subject: email.subject,
      });
      return;
    }

    await this.http.post(webhookUrl, email, {
      timeoutMs,
      flow: 'email.send',
      retry: { maxRetries },
    });

    // The body is deliberately not logged on the success path: it went somewhere,
    // and an email body is the field most likely to carry something personal.
    this.logger.debug('email sent', { to: email.to, subject: email.subject });
  }
}
