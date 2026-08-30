import { HttpService } from '@dunx/http/client';

/**
 * The providers this app can talk to.
 *
 * A frozen object rather than a TypeScript `enum`, like every other closed set in
 * this codebase: an `enum` is a runtime value TypeScript invents, and `as const`
 * gives the same narrowing with an object that is just an object.
 */
export const AIProvider = Object.freeze({
  GOOGLE: 'google',
  GROQ: 'groq',
  OPENROUTER: 'openrouter',
} as const);
export type AIProvider = (typeof AIProvider)[keyof typeof AIProvider];

export const AI_PROVIDERS = Object.values(AIProvider);

/**
 * The outbound client the providers share.
 *
 * A subclass rather than the default binding because a model call's budget is 30
 * seconds and `AIModule` is `global: true`: bound unnamed, that timeout would
 * become the default every other `HttpService` in the app resolves.
 * `AvatarsService` borrows this one deliberately - see its own note.
 *
 * **A class, not the `httpClient('ai')` token it was.** A `Token` is not a
 * constructor type, so every consumer had to reach it with `inject()` in a field
 * initialiser; a subclass is both the binding and a parameter type, so it is an
 * ordinary constructor parameter. `HttpModule.forRootAsync(config, AiHttpClient)`
 * constructs *this* class, so the body stays empty - a constructor of its own
 * would not match the `(options, logger, context)` the factory calls.
 */
export class AiHttpClient extends HttpService {}
