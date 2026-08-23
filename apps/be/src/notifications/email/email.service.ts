import { Logger } from '@dunx/core';
import { render } from '@react-email/render';
import type { ReactElement } from 'react';
import { Resend } from 'resend';
import { AppConfigService } from '../../config/app.config.service.js';

export interface Email {
  readonly to: string;
  readonly subject: string;
  /** A template from `./templates`, already given its props. */
  readonly template: ReactElement;
}

/**
 * The outbound transport, over Resend.
 *
 * Every message goes out as **both** HTML and plain text. That is not politeness:
 * a message with no `text/plain` alternative scores worse with every spam filter
 * that looks, and a password reset landing in spam is a support ticket.
 *
 * No timeout and no retry of its own. The queue owns both - `QUEUE_JOB_TIMEOUT_MS`
 * bounds the attempt and `QUEUE_MAX_RETRIES` repeats it with exponential backoff -
 * and a second retry loop inside one job attempt would multiply against that. The
 * worker's `limiter` is what keeps a burst under Resend's rate limit, so the
 * hand-rolled send queue the NestJS version carried is gone with it.
 */
export class EmailService {
  /** `undefined` when unconfigured: `new Resend(undefined)` throws. */
  readonly #resend: Resend | undefined;
  readonly #sender: string;

  constructor(
    config: AppConfigService,
    private readonly logger: Logger,
  ) {
    const { apiKey, sender } = config.get('email');
    this.#sender = sender;
    this.#resend = apiKey === undefined ? undefined : new Resend(apiKey);
  }

  /** The Resend message id, or `undefined` when nothing was sent. */
  async send({ to, subject, template }: Email): Promise<string | undefined> {
    if (this.#resend === undefined) {
      // Never the rendered message. A password-reset body carries better-auth's
      // one-time link, so logging it turns anyone with log access into an
      // account-takeover path. `LOG_MASK_FIELDS` cannot help: it masks by field
      // name, and a token inside a URL string is not a field.
      this.logger.debug('email not sent, no RESEND_API_KEY configured', {
        to,
        subject,
      });
      return undefined;
    }

    // Two renders of one tree rather than one render and an HTML-to-text pass at
    // the call site - `plainText` is the same walk with a different serialiser, and
    // it is what keeps a button's href in the text alternative.
    const [html, text] = await Promise.all([
      render(template),
      render(template, { plainText: true }),
    ]);

    const { data, error } = await this.#resend.emails.send({
      from: this.#sender,
      to,
      subject,
      html,
      text,
    });

    // Resend answers `{ data, error }` rather than throwing, so an unchecked call
    // reports every failure as a success. Thrown, because the job's retry is the
    // recovery: a 429 or a 5xx from the provider is worth another attempt.
    if (error !== null) {
      throw new Error(`resend refused the message: ${error.message}`, {
        cause: error,
      });
    }

    this.logger.debug('email sent', { to, subject, id: data?.id });
    return data?.id;
  }
}
