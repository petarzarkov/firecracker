import { bunPassword } from '@dunx/auth';
import type { BetterAuthOptions } from 'better-auth';
import { admin, anonymous, bearer, openAPI } from 'better-auth/plugins';
import type { AppConfig } from '../config/env.validation.js';
import { anonymousName } from './anon-name.js';

/**
 * The route path `AuthHandler` is mounted at, before the global prefix is
 * applied. `AuthOptions.basePath` is the same URL *after* it, which is why the
 * two are different strings for the same thing - see {@link authBasePath}.
 */
export const AUTH_MOUNT = '/auth';

/**
 * Everything `betterAuth()` takes **except** the database and secondary storage,
 * which only exist inside the container. Statics, because there are two consumers:
 * the real instance, and the database-less one `AuthDocument.for()` builds to ask
 * for an OpenAPI schema - one plugin list is what stops the document describing a
 * different API than the one that runs.
 */
/**
 * The parts of the options that need the container, handed in rather than reached
 * for: `base` is also what `AuthDocument` builds a database-less instance from, and
 * one plugin list is what stops the OpenAPI document describing a different API than
 * the one that runs.
 */
export interface AuthHookOverrides {
  /** Runs before `anonymous()` deletes the demo user. See `AccountLinker`. */
  readonly onLinkAccount?: (context: {
    anonymousUser: { user: { id: string } };
    newUser: { user: { id: string } };
  }) => void | Promise<void>;
}

export class AuthOptions {
  /** The mount *after* the global prefix - see {@link AUTH_MOUNT}. */
  static basePath(prefix: string): string {
    return `/${prefix}${AUTH_MOUNT}`;
  }

  /**
   * The callback URL a provider's OAuth app is registered with: the shape Passport
   * composed, provider segment before the literal `callback`.
   *
   * Built from the same `webUrl` and prefix better-auth's own `basePath` is, so a
   * deployment that moves either does not have to remember this exists.
   * `LegacyOAuthCallbackController` answers whatever this returns.
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
        // `Bun.password`'s native bcrypt, where better-auth defaults to a
        // pure-JavaScript scrypt. What `AuthModule` applies anyway, said out loud.
        password: bunPassword,
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
       * A provider is two environment variables and better-auth owns the callback.
       * One with only half its credentials is absent rather than half-configured -
       * see `EnvConfig` in `env.validation.ts`.
       */
      /**
       * Each provider is pinned to the callback URL its OAuth app already holds -
       * the Passport shape the NestJS version registered,
       * `<webUrl>/<prefix>/auth/<provider>/callback`, rather than better-auth's own
       * `/callback/<provider>`.
       *
       * `redirectURI` is what goes in the authorization request **and** in the token
       * exchange, and the provider compares both against its registration - so this
       * is the half that stops GitHub answering "the redirect_uri is not associated
       * with this application". `LegacyOAuthCallbackController` is the other half,
       * and neither works without it.
       */
      socialProviders: {
        ...(auth.google === undefined
          ? {}
          : {
              google: {
                ...auth.google,
                redirectURI: AuthOptions.legacyCallback(config, 'google'),
              },
            }),
        ...(auth.github === undefined
          ? {}
          : {
              github: {
                ...auth.github,
                redirectURI: AuthOptions.legacyCallback(config, 'github'),
              },
            }),
        ...(auth.linkedin === undefined
          ? {}
          : {
              linkedin: {
                ...auth.linkedin,
                redirectURI: AuthOptions.legacyCallback(config, 'linkedin'),
              },
            }),
      },
      /**
       * A social sign-in joins the account that already owns the address.
       *
       * Every provider here maps `name`, `email` and `image` off the profile by
       * better-auth's own default, so a first social sign-in arrives with an avatar
       * and a display name already filled in. What it could not do was arrive at an
       * *existing* row: implicit linking treats the IdP's `email_verified` claim as
       * proof of ownership only when the local row is verified too, and this app
       * sends no verification mail, so every email-and-password row is
       * `emailVerified: false`. Signing up with a password and later choosing Google
       * on the same address was refused as an unlinked account.
       *
       * **The trade is explicit.** Trusting a provider means believing its assertion
       * about an address instead of our own, so a provider that ever hands out an
       * address it has not verified would hand over the account with it. These three
       * verify, and the alternative on offer was worse: no linking at all, or a
       * second row that the `UQ_user_email` index refuses outright.
       *
       * `email-password` is deliberately **not** here - that direction is the one
       * where the unverified row is the claimant.
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
