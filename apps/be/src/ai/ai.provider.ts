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
 * The name of the outbound client the providers share.
 *
 * Named rather than the default binding because a model call's budget is 30 seconds
 * and `AIModule` is `global: true`: bound unnamed, that timeout would become the
 * default every other `HttpService` in the app resolves. `AvatarsService` borrows
 * this one deliberately - see its own note.
 */
export const AI_HTTP_CLIENT = 'ai';
