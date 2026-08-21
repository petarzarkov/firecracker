/**
 * Types the config tree is built from, and nothing that restates its shape.
 *
 * `AppConfig` itself is derived from `validateConfig` in `env.validation.ts` rather
 * than hand-written beside it, because two descriptions of one shape drift.
 */
export interface OAuthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}
