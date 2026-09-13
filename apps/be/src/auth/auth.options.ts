import type { BetterAuthOptions } from 'better-auth';
import { admin, anonymous, bearer, openAPI } from 'better-auth/plugins';
import type { AppConfig } from '../config/env.validation.js';
import { anonymousName } from './anon-name.js';

/** Mounted here, *before* the global prefix. {@link AuthOptions.basePath} is after it. */
export const AUTH_MOUNT = '/auth';

/** The three this app registers OAuth apps with, and the order the client shows. */
const SOCIAL_PROVIDERS = ['google', 'github', 'linkedin'] as const;

interface AuthHookOverrides {
  /** Runs before `anonymous()` deletes the demo user. See `AccountLinker`. */
  readonly onLinkAccount?: (context: {
    anonymousUser: { user: { id: string } };
    newUser: { user: { id: string } };
  }) => void | Promise<void>;
}

export class AuthOptions {
  /** The mount *after* the global prefix. */
  static basePath(prefix: string): string {
    return `/${prefix}${AUTH_MOUNT}`;
  }

  /**
   * The callback URL a provider's OAuth app is already registered with: the shape
   * Passport composed, provider before the literal `callback`, not better-auth's
   * `/callback/<provider>`. `LegacyOAuthCallbackController` answers it.
   */
  static legacyCallback(config: AppConfig, provider: string): string {
    return `${config.auth.baseUrl}${AuthOptions.basePath(config.app.prefix)}/${provider}/callback`;
  }

  static base(config: AppConfig, hooks?: AuthHookOverrides) {
    const { auth } = config;
    const origins = [auth.baseUrl, ...auth.trustedOrigins];

    return {
      appName: config.app.name,
      secret: auth.secret,
      baseURL: auth.baseUrl,
      basePath: AuthOptions.basePath(config.app.prefix),
      trustedOrigins: [...new Set(origins)],
      advanced: {
        // The app's own ids are uuid v4 everywhere else, including the columns
        // better-auth writes to. One id shape across every table.
        database: { generateId: () => crypto.randomUUID() },
      },
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        maxPasswordLength: 64,
      },
      session: {
        expiresIn: auth.sessionExpiration,
        updateAge: auth.sessionUpdateAge,
        /**
         * **Off, and this is not a tuning choice.** The cookie cache signs a copy of
         * the session *and the user* into the cookie, so `getSession` answers from it
         * without reading the database - and keeps answering for `maxAge` after the
         * user row is gone.
         *
         * That row does get deleted: `anonymous()` removes the demo account when a
         * player converts it to a real one. For the next five minutes the server then
         * believed in a user this database did not have, which surfaced as
         * `FOREIGN KEY constraint failed` from `WalletRepository.getOrCreate` on the
         * socket's very first frame - no balance, and a 400 on every reconnect.
         *
         * The cost is one indexed SQLite read per `getSession`, which is what makes
         * the answer true. `auth.spec.ts` holds it: a session whose user was deleted
         * must resolve to nothing.
         */
        cookieCache: { enabled: false },
      },
      /**
       * `redirectURI` goes in the authorization request **and** the token exchange,
       * and the provider compares both against its registration - so this is the
       * half that stops GitHub answering "the redirect_uri is not associated with
       * this application". `LegacyOAuthCallbackController` is the other half.
       */
      socialProviders: Object.fromEntries(
        SOCIAL_PROVIDERS.flatMap((name) => {
          const credentials = auth[name];
          return credentials === undefined
            ? []
            : [
                [
                  name,
                  {
                    ...credentials,
                    redirectURI: AuthOptions.legacyCallback(config, name),
                  },
                ],
              ];
        }),
      ),
      /**
       * A social sign-in joins the account that already owns the address.
       *
       * Implicit linking trusts the IdP's `email_verified` only when the local row
       * is verified too, and this app sends no verification mail - so every
       * password row is `emailVerified: false`, and signing up with a password then
       * choosing Google on the same address was refused as unlinked.
       *
       * **The trade is explicit:** trusting a provider means believing its
       * assertion about an address instead of ours, so one that ever hands out an
       * unverified address hands over the account with it. `email-password` is
       * deliberately absent - that is the direction where the unverified row is the
       * claimant.
       */
      account: {
        accountLinking: { trustedProviders: ['google', 'github', 'linkedin'] },
      },
      plugins: [
        // `role` on the user, which `@Roles()` reads through `SessionGuard`, plus
        // ban and impersonation.
        admin(),
        /**
         * "Try Demo". Not a nicety: a demo wallet is per-user, so `wallet.user_id`
         * needs a row to point at - playing without signing up is an *account* that
         * happens to be anonymous. Watching, which needs no wallet, is the case
         * that needs no session at all.
         *
         * `emailDomainName` is what a later sign-up links against, so it has to be
         * a domain we own rather than the default `example.com`.
         *
         * `generateName` is not cosmetic either: without it every demo player is
         * called `Anonymous`, and `user.name` is what the lobby list, every bet row
         * and every chat line render. See {@link anonymousName}.
         */
        anonymous({
          emailDomainName: 'demo.firecracker.local',
          generateName: anonymousName,
          /**
           * What a conversion keeps.
           *
           * Without this the plugin links the accounts, deletes the demo user, and
           * every table referencing it cascades - bets, wallet, uploaded avatar -
           * so the moment a player decided to keep their run was the moment it was
           * thrown away. `AccountLinker` moves it first; see `auth.module.ts` for
           * where the handle comes from.
           */
          ...(hooks?.onLinkAccount === undefined
            ? {}
            : { onLinkAccount: hooks.onLinkAccount }),
        }),
        // `Authorization: Bearer <token>` instead of a cookie, which is what a
        // non-browser client and the e2e suite use.
        bearer(),
        // Without this plugin `generateOpenAPISchema` does not exist and
        // `betterAuthDocument` contributes nothing. `disableDefaultReference`
        // stops better-auth mounting a second explorer page next to dunx's.
        openAPI({ disableDefaultReference: true }),
      ],
      // `satisfies`, not a return annotation: an annotation widens `plugins` to
      // `BetterAuthPlugin[]`, and `betterAuth()` infers `api` from that tuple - so
      // the widened form yields an instance with no `generateOpenAPISchema`.
    } satisfies BetterAuthOptions;
  }
}
