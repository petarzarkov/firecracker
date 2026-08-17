import { inject, Logger } from '@dunx/core';
import { httpClient } from '@dunx/http/client';
import { AI_HTTP_CLIENT } from '../../ai/ai.provider.js';
import { AppConfigService } from '../../config/app.config.service.js';

/** Slack wants `:name:`, and the type stops a bare word being passed by mistake. */
type Emoji = `:${string}:`;

/**
 * Service notices in Slack: deploys, boots, anything an operator should see
 * without reading a log.
 *
 * **Silent when unconfigured.** With no `SLACK_BOT_TOKEN` every call returns
 * immediately, which is the same contract every other optional integration here
 * keeps - the feature is absent rather than broken, and nothing upstream has to
 * branch on whether Slack exists.
 *
 * It never throws either. A notification that fails is a notification that did not
 * arrive; it is not a reason to fail the thing being notified about.
 */
export class SlackService {
  readonly #http = inject(httpClient(AI_HTTP_CLIENT));
  readonly #token: string;
  readonly #channel: string;

  constructor(
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {
    const slack = config.get('slack');
    this.#token = slack.botToken ?? '';
    this.#channel = slack.channel ?? '';
  }

  get configured(): boolean {
    return this.#token.length > 0 && this.#channel.length > 0;
  }

  async send(message: string, emoji: Emoji = ':rocket:'): Promise<void> {
    if (!this.configured) return;

    const { name, version, env, nodeEnv } = this.config.get('app');
    const { commitSha, commitMessage } = this.config.get('service');

    try {
      await this.#http.post(
        'https://slack.com/api/chat.postMessage',
        {
          channel: this.#channel,
          username: name,
          icon_emoji: emoji,
          attachments: [
            {
              color: '#d3d9e3',
              pretext: message,
              fallback: message,
              title: `Commit: ${commitSha || 'dev-sha'}`,
              fields: [
                { title: 'Name', value: name, short: true },
                { title: 'Version', value: version, short: true },
                { title: 'Environment', value: env, short: true },
                { title: 'Node Environment', value: nodeEnv, short: true },
                ...(commitMessage
                  ? [
                      {
                        title: 'Commit Message',
                        value: commitMessage,
                        short: false,
                      },
                    ]
                  : []),
              ],
              footer: name,
              ts: Math.floor(Date.now() / 1000),
            },
          ],
        },
        { headers: { authorization: `Bearer ${this.#token}` } },
      );
    } catch (error) {
      this.logger.warn('could not post to slack', {
        reason: (error as Error).message,
      });
    }
  }
}
