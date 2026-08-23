import { describe, expect, test } from 'bun:test';
import { EnvConfig } from '../config/env.validation.js';
import { AuthOptions } from './auth.options.js';

const config = (extra: Record<string, string> = {}) =>
  EnvConfig.validate({ API_PORT: '3001', ...extra });

describe('account linking', () => {
  /**
   * The three social providers are trusted; `email-password` is not. Without this an
   * account created with a password could never be reached by a social sign-in,
   * because nothing here verifies an address so no local row is ever
   * `emailVerified: true` - see the comment on the option for the trade it makes.
   */
  test('trusts the social providers, and not the password form', () => {
    const trusted =
      AuthOptions.base(config()).account.accountLinking.trustedProviders;

    expect(trusted).toEqual(['google', 'github', 'linkedin']);
    expect(trusted).not.toContain('email-password');
  });

  /**
   * The policy is about which assertions we believe, not about which credentials
   * happen to be present, so it does not move when a provider is unconfigured -
   * otherwise adding `GOOGLE_OAUTH_*` to a deployment would quietly change how
   * every *other* provider links.
   */
  test('does not depend on which providers are configured', () => {
    const withGoogle = config({
      GOOGLE_OAUTH_CLIENT_ID: 'id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
    });

    expect(
      AuthOptions.base(withGoogle).account.accountLinking.trustedProviders,
    ).toEqual(
      AuthOptions.base(config()).account.accountLinking.trustedProviders,
    );
  });
});
