import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { Logger } from '@dunx/core';
import { render } from '@react-email/render';
import type { AppConfigService } from '../../config/app.config.service.js';
import { EmailService } from './email.service.js';
import { AccountSuspendedEmail } from './templates/account-suspended-email.js';
import { InviteEmail } from './templates/invite-email.js';
import { PasswordResetEmail } from './templates/password-reset-email.js';
import { WelcomeEmail } from './templates/welcome-email.js';

const RESET_URL = 'https://play.test/api/auth/reset-password/tok-9f3?to=%2F';
const INVITE_URL = 'https://play.test/?inviteCode=FC-7Q2M-8XKD';

const logger = (): Logger =>
  ({ debug: mock(() => undefined) }) as unknown as Logger;

const config = (apiKey?: string): AppConfigService =>
  ({
    get: () => ({ apiKey, sender: 'Firecracker <no-reply@play.test>' }),
  }) as unknown as AppConfigService;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Captures the one request Resend makes, and answers it. */
const stubResend = (answer: Response) => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = mock(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return answer.clone();
    },
  ) as unknown as typeof fetch;
  return calls;
};

describe('the templates', () => {
  const cases = [
    ['welcome', WelcomeEmail({ name: 'Ada', webUrl: 'https://play.test' })],
    [
      'password reset',
      PasswordResetEmail({ name: 'Ada', resetUrl: RESET_URL }),
    ],
    [
      'account suspended',
      AccountSuspendedEmail({ name: 'Ada', reason: 'Scripted betting.' }),
    ],
    [
      'invite',
      InviteEmail({
        email: 'ada@example.com',
        inviteCode: 'FC-7Q2M-8XKD',
        role: 'user',
        inviteUrl: INVITE_URL,
      }),
    ],
  ] as const;

  test.each(cases)('%s renders to a complete document', async (_name, tree) => {
    const html = await render(tree);

    expect(html).toStartWith('<!DOCTYPE html');
    expect(html).toContain('Firecracker');
    // The card, not just the tags: a template that lost its layout still renders.
    expect(html).toContain('#1a1a1a');
  });

  /**
   * The failure this guards is silent. `plainText` re-serialises the same tree, and
   * a link that lives *only* in a `<Button href>` comes out as bare label text - so
   * the recipient of the text alternative gets "Reset password" and no way to.
   */
  test('the reset link survives into the plain-text alternative', async () => {
    const tree = PasswordResetEmail({ name: 'Ada', resetUrl: RESET_URL });

    expect(await render(tree)).toContain(RESET_URL);
    expect(await render(tree, { plainText: true })).toContain(RESET_URL);
  });

  test('the invite link and code survive into the plain-text alternative', async () => {
    const tree = InviteEmail({
      email: 'ada@example.com',
      inviteCode: 'FC-7Q2M-8XKD',
      role: 'user',
      inviteUrl: INVITE_URL,
    });
    const text = await render(tree, { plainText: true });

    expect(text).toContain(INVITE_URL);
    expect(text).toContain('FC-7Q2M-8XKD');
  });
});

describe('EmailService', () => {
  const message = {
    to: 'ada@example.com',
    subject: 'Reset your Firecracker password',
    template: PasswordResetEmail({ name: 'Ada', resetUrl: RESET_URL }),
  };

  /**
   * The degrade path, and the reason `RESEND_API_KEY` is optional: a fresh clone
   * boots, and the queue still demonstrably delivers a job to a worker.
   */
  test('sends nothing, and does not throw, with no api key', async () => {
    const calls = stubResend(Response.json({ id: 'never' }));
    const log = logger();

    const id = await new EmailService(config(), log).send(message);

    expect(id).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(log.debug).toHaveBeenCalledTimes(1);
  });

  test('sends both an html and a plain-text alternative', async () => {
    const calls = stubResend(Response.json({ id: 'email-1' }));

    const id = await new EmailService(config('re_test'), logger()).send(
      message,
    );

    expect(id).toBe('email-1');
    expect(calls).toHaveLength(1);
    const body = calls[0]?.body ?? {};
    expect(body['from']).toBe('Firecracker <no-reply@play.test>');
    expect(body['to']).toBe('ada@example.com');
    // Both halves, both carrying the link. A message with no `text/plain` scores
    // worse with every spam filter that looks, and a reset in spam is a ticket.
    expect(String(body['html'])).toContain(RESET_URL);
    expect(String(body['text'])).toContain(RESET_URL);
  });

  /**
   * Resend answers `{ data, error }` rather than throwing, so an unchecked call
   * reports every refusal as a send. The throw is what spends the job's retry.
   */
  test('a refusal from Resend is thrown, not swallowed', async () => {
    // The SDK console.errors every non-2xx outside production, and a red block in a
    // passing suite reads as a failure.
    const consoleError = console.error;
    console.error = () => undefined;

    stubResend(
      Response.json(
        {
          name: 'validation_error',
          message: 'The from address is not verified',
        },
        { status: 422 },
      ),
    );

    const send = new EmailService(config('re_test'), logger()).send(message);

    await expect(send).rejects.toThrow('The from address is not verified');
    console.error = consoleError;
  });
});
