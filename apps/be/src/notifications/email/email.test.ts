import { describe, expect, test } from 'bun:test';
import { render } from '@react-email/render';
import { AccountSuspendedEmail } from './templates/account-suspended-email.js';
import { InviteEmail } from './templates/invite-email.js';
import { PasswordResetEmail } from './templates/password-reset-email.js';
import { WelcomeEmail } from './templates/welcome-email.js';

const RESET_URL = 'https://play.test/api/auth/reset-password/tok-9f3?to=%2F';
const INVITE_URL = 'https://play.test/?inviteCode=FC-7Q2M-8XKD';

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
