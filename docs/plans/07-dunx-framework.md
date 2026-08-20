# 07 - dunx framework changes

Six changes on branch `feat/firecracker-driven-gaps` in `~/repos/dunx`, all driven by
friction recorded in this repo. Nothing is published and no version is bumped; the
proposed semver and the draft changelog are at the end for a human to act on.

| # | Item | Shipped | Where |
| - | ---- | ------- | ----- |
| 1 | Sync `paginate` | yes | `@dunx/infra/pagination` |
| 2 | First-class throttle | yes | `@dunx/http` (not `@dunx/infra` - see below) |
| 3 | WebSocket middleware | yes | `@dunx/http` |
| 4 | Static serving 401-vs-404 | verdict + hardening, no behaviour change | `@dunx/http` |
| 5 | Cleaner modules | yes | `@dunx/core` |
| 6 | Teardown no longer short-circuits | yes (added scope) | `@dunx/core`, `@dunx/http`, `@dunx/infra` |

---

## 1 - `paginate` follows its driver

**Was.** `paginate` was `async` and awaited the drizzle query builder, one code path
for `bun-sqlite` and `bun-sql` both. Every repository over the synchronous driver
therefore had one `async` method it did not want, and `transactionSync`'s atomicity
argument stopped at the boundary of `list`.

**Now.** Two overloads, discriminated by the shape of `db` rather than by a flag, so
the return type follows the input.

```ts
export interface PaginateSource<TTable extends Table, TResult> {
  select: () => {
    from: (table: TTable) => {
      where: (condition: SQL | undefined) => {
        orderBy: (...columns: SQL[]) => { limit: (rows: number) => TResult };
      };
    };
  };
}

export interface SyncRows { all: () => unknown[] }

export interface PaginateParams<TTable extends Table> extends PaginateBase<TTable> {
  readonly db: PaginateSource<TTable, PromiseLike<unknown[]>>;
}
export interface SyncPaginateParams<TTable extends Table> extends PaginateBase<TTable> {
  readonly db: PaginateSource<TTable, SyncRows>;
}

export function paginate<TTable extends Table, TRow extends Record<string, unknown>>(
  params: SyncPaginateParams<TTable>,
): Page<TRow>;
export function paginate<TTable extends Table, TRow extends Record<string, unknown>>(
  params: PaginateParams<TTable>,
): Promise<Page<TRow>>;
```

Why overloads and not a `paginateSync`: `db` already carries the answer.
`drizzle-orm/bun-sqlite` answers `all(): T[]`, `drizzle-orm/bun-sql` has no `all` at
all, and an async SQLite driver's `all(): Promise<T[]>` is not assignable to
`() => unknown[]` - so all three land on the right overload with no second exported
name and no call-site change.

The runtime does not trust the shape, it adopts the value: `typeof query.all ===
'function'` decides whether to call it, and `Array.isArray(rows)` decides the
channel. A driver whose `all()` returns a promise is awaited correctly.

**One behaviour change.** An argument error - a table with no tie-break column -
now **throws** rather than rejecting, on both channels. It is a `TypeError` about the
call and the synchronous overload has nowhere to reject from. `await paginate(...)`
inside `try`/`catch` is unaffected; `paginate(...).catch(...)` is not.

**Files:** `packages/infra/src/pagination/keyset.ts`,
`packages/infra/src/pagination/pagination.test.ts` (+7 cases),
`examples/full/src/database/ledger.{service,controller}.ts` (now synchronous, which is
the demonstration), and the two vendored copies under
`tools/create-app/templates/features/database/`.

## 2 - A first-class throttle

dunx 2.1.1 shipped none. It does now, and it covers everything
`docs/plans/03-module-hygiene.md` asked for.

**It lives in `@dunx/http`, not `@dunx/infra/throttle`.** A throttle is a
`Middleware` reading a `MetaKey` off a `RouteContext` and needing `ClientAddress` and
`HttpError`; `@dunx/infra` must not depend on the web layer, which is the boundary
that made `@dunx/auth` its own package. The Redis half costs `@dunx/http` no
dependency because the client is taken structurally, exactly as `RedisRelay` takes
`Bun.RedisClient`.

```ts
export interface ThrottleLimit { readonly limit: number; readonly windowSeconds: number }
export const THROTTLE: MetaKey<ThrottleLimit>;
export const SKIP_THROTTLE: MetaKey<boolean>;
export const Throttle: (limit: ThrottleLimit) => <F extends object>(target: F) => F;
export const SkipThrottle: () => <F extends object>(target: F) => F;

export abstract class ThrottleStore {
  abstract hit(key: string, windowSeconds: number): Promise<number | undefined>;
  abstract ttl(key: string): Promise<number | undefined>;
}
export interface ThrottleRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
}
export class RedisThrottleStore extends ThrottleStore { constructor(redis: ThrottleRedis) }
export class MemoryThrottleStore extends ThrottleStore { constructor(maxKeys?: number) }

export interface ThrottleOptionsInit extends ThrottleLimit {
  readonly prefix: string;                                    // required, empty throws
  readonly subject?: (req: BunRequest, ctx: RouteContext) => string | undefined;
  readonly headers?: boolean;                                 // default true
  readonly store?: ThrottleStore;                             // default MemoryThrottleStore
}
export class ThrottleOptions { constructor(init: ThrottleOptionsInit) }
export class ThrottleGuard implements Middleware {}

export class ThrottleModule {
  static forRoot(init: ThrottleOptionsInit): DynamicModule;            // global: true
  static forRootAsync<const D extends Deps>(
    config: FactoryProvider<ThrottleOptionsInit, D> & { imports?: DynamicModule['imports'] },
  ): DynamicModule;
}
```

Every behaviour the spec named holds, and each has a test:

1. Fixed window - `INCR`, then `EXPIRE` **only** on the call that returned `1`
   (asserted by counting `expire` calls across three hits).
2. Fails open, warning **once per process**, never once per request.
3. Key is `${prefix}:throttle:${ctx.controller}:${ctx.handler}:${subject}`, so two
   verbs on one path have separate budgets and a parameterised path does not
   fragment.
4. `prefix` has no default; `''` and `'   '` throw. `limit` and `windowSeconds`
   below 1 throw too.
5. `UNMATCHED` is skipped before the store is touched - a burst of 404s spends
   nothing and costs no round trip.
6. `@Throttle` at class scope covers every handler, a handler's own wins, via the
   `mergeMeta(klass, handler)` precedence `@Roles` already has.
7. The 429 is **thrown**, so it goes through the app's `onError`.
8. Ordering is the app's, documented on the guard and on the module.

**One supporting change.** `HttpError` gained `headers`:

```ts
export interface HttpErrorOptions extends ErrorOptions {
  readonly headers?: Readonly<Record<string, string>>;
}
```

`errorMapper` copies them onto the response, so a thrown 429 can still carry
`Retry-After` and `RateLimit-*`. It is also what a 401's `WWW-Authenticate` and a
405's `Allow` needed. **An app that replaces the mapper has to read `error.headers`
itself** - firecracker's `ErrorMapper.toResponseBody` does not, so the 429 body will
be right and the headers absent until it does.

**Files:** `packages/http/src/throttle/{decorators,options,store,guard,module}.ts`,
`packages/http/src/throttle/throttle.test.ts` (17 cases),
`packages/http/src/server/errors.ts`, `packages/http/src/index.ts`.

## 3 - WebSocket middleware

Mirrors the HTTP chain rather than inventing a second vocabulary: one interface, one
method, wrapping `next()`, folded into one closure per slot at boot.

```ts
export interface SocketContext {
  readonly gateway: string;
  readonly path: string;
  readonly kind: HandlerKind;          // reused, not redeclared
  readonly event: string | undefined;
}
export interface SocketFrame { readonly socket: Socket; readonly data: unknown }
export type SocketNext = () => unknown;

export interface SocketMiddleware {
  handle(frame: SocketFrame, ctx: SocketContext, next: SocketNext): unknown;
}

export type SocketDispatch = (frame: SocketFrame, run: SocketNext) => unknown;
export const composeSocket: (
  middleware: readonly SocketMiddleware[], ctx: SocketContext,
) => SocketDispatch;

/** Reports how `next()` settled, on whichever channel it settled on, and rethrows. */
export const observe: (
  next: SocketNext, done: (error: unknown, value: unknown) => void,
) => unknown;

export class SocketLoggingMiddleware implements SocketMiddleware {
  constructor(logger: Logger, context: RequestContext, options?: SocketLoggingOptions);
}
export interface SocketLoggingOptions {
  readonly level?: LogLevel;                                   // default 'debug'
  readonly errorLevel?: LogLevel;                              // default 'error'
  readonly events?: Readonly<Record<string, LogLevel | false>>; // per event, false skips
  readonly lifecycle?: LogLevel | false;                       // open/close/drain/ping/pong
  readonly payload?: boolean;                                  // default false
  readonly maxPayloadLength?: number;                          // default 512
  readonly correlate?: boolean;                                // default true
}

// HttpOptions gains:
readonly socketMiddleware?: readonly Ctor<SocketMiddleware>[];
readonly socketLogging?: boolean | SocketLoggingOptions;   // on by default, at debug
```

Points that matter for this gateway:

- **`SocketData` gained `id`**, minted at the upgrade. Bun's socket carries no
  identity, so a frame's log line could not be joined to the connect and disconnect
  around it. Every entry on one connection shares it, and it goes into the
  `RequestContext` scope as `connectionId` alongside `event` and `flow: 'ws'` - so a
  service four frames down carries it without being handed the socket.
- **`open` and `close` are wrapped even when the gateway declares neither**, so a
  connection is never invisible to an observer.
- **An event no `@OnMessage` claims reaches the chain**, with the event name on the
  context. This is the socket analogue of the HTTP not-found fallback; today such a
  frame is dropped in silence.
- **`debug`, not `info`.** `ConsoleLogger`'s threshold is `info`, so the default
  writes nothing until an app lowers its level - which is what makes it safe to
  default on. `events: { tick: false }` drops a hot event entirely: no entry, no
  timing, no scope.
- Installing it takes `SocketOptions.onError`'s bare `console.error` out of the way,
  because the middleware already saw the failure with the gateway and the event on
  it.

**What it cannot see**, and so cannot replace: a `socket.send` a handler makes
itself (this gateway's `betAck`/`cashOutAck`/`seedAck` are sent, not returned), a
`PubSub` broadcast, and the upgrade - which is an HTTP request answered by the
gateway's own route and never enters the socket dispatcher. Returning the ack from
the handler instead of sending it is what brings it inside.

**Files:** `packages/http/src/ws/{middleware,logging}.ts` (new),
`packages/http/src/ws/{adapter,socket}.ts`, `packages/http/src/server/{application,factory}.ts`,
`packages/http/src/ws/middleware.test.ts` (14 cases).

## 4 - The 401 instead of 404: the app owns it

**Verdict: dunx is behaving as designed, and the fix is app-side and already
shipped here.** Two independent causes, both outside the framework:

1. `notFound` defaults to `'guarded'`, which gives a miss no route metadata, so a
   global `SessionGuard` refuses it and an anonymous caller sees 401 rather than 404.
   That default is deliberate - a 404 on a miss while every real path answers 401
   tells a prober which paths exist - and `apps/be/src/http.options.ts` already sets
   `notFound: 'public'`.
2. A miss is a **`throw`**, not a returned `Response`. `miss` raises
   `HttpError(404)` at `packages/http/src/server/routes.ts:175` and `compose`
   propagates it, so `SpaFallback`'s `const response = await next(); if
   (response.status !== 404) return response;` never reaches its second line on the
   one path it exists for.

No framework behaviour was changed. What changed is that the contract is now stated
where someone reading it will be:

- `buildFallback`'s doc says outright that the miss is a throw, shows the
  `try`/`catch` shape, and points at `ctx.get(UNMATCHED)` as the cheaper test that
  works **before** `next()` - and distinguishes "nothing matched" from "a handler
  answered 404 for a missing record".
- `StaticModule`'s doc replaces its `@Get('/*')` suggestion with a worked
  `SpaFallback` built on `UNMATCHED`, and names both the `notFound: 'guarded'` trap
  and the ordering constraint.

**Files:** `packages/http/src/server/routes.ts`, `packages/http/src/static/module.ts`
(comments only).

## 5 - Cleaner modules

### The design

The evidence in this repo is six `static forRoot()` methods that take **no
arguments** and exist only to say "imports plus providers plus `global: true`", and
seven separate comments warning that `forRoot()` returns a new object per call. The
framework rule behind both is `@dunx/core`'s "a module is decorated **or**
configured, never both", and that rule exists for one reason: `resolveRef`
**concatenated** decorator metadata with a `DynamicModule`'s options, so a class that
was both registered everything twice.

Rather than make that a boot error, make the two compose. Three changes, all
additive, all backward compatible:

**5.1 The merge is a union, not a concatenation.** An entry present in both the
decorator and the `DynamicModule` appears once. For `providers` the join is keyed on
the **token** and the configured binding wins - so a decorator becomes the place to
put the default:

```ts
@Module({ providers: [provide(Options, { useValue: defaults })], exports: [Options] })
export class Feature {
  static forRoot(init: Init): DynamicModule {
    return { module: Feature, providers: [provide(Options, { useValue: new Options(init) })] };
  }
}
```

`Feature` used bare gives the default; `Feature.forRoot(init)` overrides it; both
keep the decorator's `exports`. The within-one-list duplicate is still a boot error,
with a message that now says which case it is.

**5.2 `exports` may name a configured import by its class.**

```ts
@Module({
  imports: [AuthModule.forRootAsync({ useFactory, inject })],
  exports: [AuthModule],          // resolves to the configuration above
})
export class AppAuthModule {}
```

Previously that was an unresolvable-token failure blamed on the exporting module, and
the workaround was hoisting the `forRootAsync(...)` result to a module-level `const`
so the same object could appear twice - which is exactly the shape
`apps/be/src/auth/auth.module.ts` has. A bare-class import is untouched (it is
already the reference the scope is keyed on), and a provider token this module
declares always wins over the rewrite.

**5.3 A boot warning for the same module configured twice.** When one module class is
registered more than once and the registrations bind the **same token**, the graph
warns, naming the class and the token:

> `AuthModule is registered 2 times, and each registration binds Auth again. A
> configured module is keyed on the object forRoot() returned, and it returns a new
> one per call - so these are separate scopes holding separate instances. Call it
> once and share the result, or mark the module global: true...`

Two registrations binding **different** tokens stay silent, because that is the
supported shape - `RedisModule.forRoot()` alongside `RedisModule.forRoot({ name:
'cache' })` is two connections on purpose, and the named one binds named tokens. This
is the trap seven comments in this repo describe, made visible at boot.

**Not done, and deliberately.** A `ConfigurableModule` base to remove the
`forRoot`/`forRootAsync` boilerplate from every options-carrying module was designed
and dropped: eight in-repo modules would use it, but with 5.1 in place the
`@Module` + `forRoot` pattern is already safe, and adding a mixin ahead of a second
consumer is the speculative abstraction dunx's own CLAUDE.md rules out.

**Files:** `packages/core/src/di/module.ts`, `packages/core/src/di/scope.ts`,
`packages/core/src/di/module-compose.test.ts` (11 cases).

## 6 - Teardown ran to the first failure and then stopped

Added scope, and the highest-severity item here: a hung shutdown rather than an
ergonomic wart.

`App.shutdown()` iterated providers with `await instance.onShutdown()` in a bare
loop. One throwing hook aborted it, every remaining provider kept its resources, and
`#resolveClosed` was never reached - so `app.closed` never resolved and the process
ended in `SIGKILL`. `drain()` was worse: `Promise.all` over the `onBeforeShutdown`
hooks meant one rejection rejected the whole drain, which aborted `shutdown()` at its
own `await this.drain()` before a single `onShutdown` had run.

Both now settle every hook, log each failure against the provider that raised it,
resolve `closed` in a `finally`, and throw the aggregate afterwards so a caller still
observes it.

```ts
/** A lone failure passes through; several become an AggregateError. */
export const teardownError: (failures: readonly unknown[]) => unknown;
/** The inverse, so one phase collecting from another does not nest aggregates. */
export const teardownFailures: (error: unknown) => readonly unknown[];
```

The same shape was applied to the two other classes that own a teardown, because
each interleaves something between the container's phases:

- `HttpApplication.shutdown()` - drain, `server.stop()`, `PubSub.close()`,
  `app.shutdown()`. A failing drain used to leave the port open.
- `WorkerApplication.shutdown()` - `consumer.stop()` then `app.shutdown()`. A
  consumer that could not stop used to skip the container teardown entirely.

This is what `Readiness`/`OnBeforeShutdown` and the "workers stop before the
connections their handlers use" ordering in this repo were relying on and not
getting.

**Files:** `packages/core/src/di/{app,lifecycle,index}.ts`,
`packages/http/src/server/application.ts`, `packages/infra/src/queue/worker.ts`,
`packages/core/src/di/teardown.test.ts` (6 cases).

### Assessed, not fixed

Four items the docs pass flagged as probable code bugs:

- **No `x-request-id` on a failure response.** Real. Not cheap: the middleware
  rethrows and the mapper builds a fresh `Response` outside the chain, so the fix is
  either a signature change to `errorMapper` (it would have to read `requestId` back
  out of `RequestContext`) or a stamp applied after the mapper in `buildRoutes` and
  `buildFallback`. Neither is a one-liner and an app's own mapper would need the same
  treatment. Left for its own change.
- **A method miss runs the whole global middleware chain**, because Bun does not
  answer it natively once a `fetch` fallback exists. Behavioural, needs its own
  decision about what an `OPTIONS` miss should cost.
- **`override` of an unbound class token does not throw**, because a class self-binds
  lazily. A typo'd class override is silent. Cheap to fix but it changes what
  `assertEveryOverrideReplaced` accepts, so it wants its own change and its own
  test sweep.
- **`'trust proxy'` is a hop count, not a boolean.** The type is already
  `boolean | number` and `settings.ts` documents the counting-from-the-right rule.
  Documentation only; nothing to fix in code.

---

## What firecracker can now delete

| File | Lines | Replaced by |
| ---- | ----- | ----------- |
| `apps/be/src/core/decorators/throttle.decorator.ts` | 25 | `Throttle`, `SkipThrottle`, `THROTTLE` from `@dunx/http` |
| `apps/be/src/infra/redis/guards/throttle.guard.ts` | 94 | `ThrottleGuard` + `RedisThrottleStore` |

Both go on the same day, with `ThrottleModule.forRootAsync({ useFactory: (config, redis)
=> ({ ...config.throttle, prefix: config.app.name, store: new RedisThrottleStore(redis),
subject: (req) => caller.optional()?.id ?? address.of(req) }), inject: [...] })` and
`ThrottleGuard` staying where it is in `http.options.ts` - after `SessionGuard`.

Two more become possible rather than automatic:

- **`apps/be/src/game/game.gateway.ts`** keeps its handlers, but its hand-logging and
  the raw `console.error` path go to `socketLogging: { events: { ... } }`. Turning the
  three `*Ack` sends into handler return values is what brings the acks inside the
  middleware too.
- **The six zero-argument `static forRoot()` wrappers** (`DatabaseModule`,
  `RedisModule`, `SchedulesModule`, `FilesModule`, `ImagesModule`, `HealthModule` in
  `apps/be/src/infra/*`) become `@Module({ global: true, imports: [...] })` decorated
  classes with stable identity, now that a decorated class may also carry a
  `forRoot()` for the part that genuinely varies. `apps/be/src/auth/auth.module.ts`
  loses its hoisted `const` via item 5.2.

Not deletable, and the reasons stand: `maxRetries: 0`, the SQLite pragma order,
`isolation: 'process'`, `critical: false` on the Redis indicator, and every
`global: true`.

## Proposed semver

One release covering all six. **`minor`** - `2.2.0`.

Everything is additive except three type-level or edge-case changes, none of which is
a breaking API removal:

- `paginate`'s return type follows `db`, so a `bun-sqlite` caller who annotated
  `Promise<Page<T>>` gets a type error and a caller who chained `.then()` gets a
  runtime one. `await` is unaffected.
- `paginate`'s missing-tie-break-column `TypeError` throws rather than rejecting.
- `App.shutdown()` and `App.drain()` now reject with the aggregate of every failed
  hook where they used to reject with the first. A caller that awaited them and
  ignored the error is unaffected; one that matched on the error's identity is not.

`SocketData` gaining a required `id` is a type change only for code that constructs a
`SocketData` literal, which is `@dunx/http` itself.

### Draft changelog

```
### Added

- `@dunx/http`: a first-class rate limit - `ThrottleModule`, `ThrottleGuard`,
  `@Throttle`/`@SkipThrottle`, and a `ThrottleStore` with Redis and in-process
  implementations. Fixed window, fails open with one warning per process, keyed per
  handler, and `prefix` is required with no default.
- `@dunx/http`: WebSocket middleware. `SocketMiddleware` wraps every dispatched
  gateway handler the way `Middleware` wraps a route, and
  `SocketLoggingMiddleware` writes one structured entry per frame at `debug`, with a
  level per event. `HttpOptions.socketMiddleware` and `HttpOptions.socketLogging`.
- `@dunx/http`: `SocketData.id`, a per-connection id minted at the upgrade, carried
  into the request-context scope as `connectionId`.
- `@dunx/http`: `HttpError` accepts `headers`, which `errorMapper` copies onto the
  response - `Retry-After` on a 429, `WWW-Authenticate` on a 401.
- `@dunx/infra/pagination`: `paginate` has a synchronous overload. A
  `drizzle-orm/bun-sqlite` handle answers a `Page`, `bun-sql` a `Promise<Page>`, so a
  repository over the synchronous driver needs no `async list`.
- `@dunx/core`: `teardownError` and `teardownFailures`, for an application class that
  runs its own teardown phase.

### Changed

- `@dunx/core`: `@Module` and a static `forRoot()` on one class now compose. The
  decorator's options and the `DynamicModule`'s are unioned rather than concatenated,
  and a configured provider replaces the declared binding for the same token instead
  of registering a second one.
- `@dunx/core`: an `exports` entry naming a module class resolves to the configured
  module of that class this module imports, so re-exporting a `forRoot()` result no
  longer needs it hoisted to a `const`.
- `@dunx/http`: the not-found fallback and `StaticModule` document that an unmatched
  path is a thrown `HttpError(404)` rather than a returned `Response`, and that
  `ctx.get(UNMATCHED)` is how a middleware detects one.

### Fixed

- `@dunx/core`: one throwing `onShutdown` no longer aborts teardown. Every hook runs,
  each failure is logged against its provider, `app.closed` resolves, and the
  aggregate is thrown afterwards. `drain()` uses `Promise.allSettled`, so a failing
  `onBeforeShutdown` no longer prevents every `onShutdown` from running.
- `@dunx/http`: `HttpApplication.shutdown()` no longer skips `server.stop()`,
  `PubSub.close()` or the container teardown when an earlier phase failed.
- `@dunx/infra`: `WorkerApplication.shutdown()` no longer skips the container
  teardown when the queue consumer could not be stopped.
- `@dunx/core`: the graph warns when one module class is registered twice and both
  registrations bind the same token - the `forRoot()`-called-twice trap.

### Breaking-ish

- `@dunx/infra/pagination`: `paginate` over a synchronous driver returns `Page<T>`,
  not `Promise<Page<T>>`. `await` is unaffected; an explicit `Promise<Page<T>>`
  annotation or a `.then()` chain is not. A missing tie-break column now throws
  rather than rejecting.
- `@dunx/core`: `shutdown()` and `drain()` reject with an `AggregateError` of every
  failure rather than the first one.
```

---

## Evidence

`bun run typecheck`, all 20 workspaces:

```
$ bun run --filter '*' typecheck
@dunx/transform typecheck: Exited with code 0
@dunx/testing typecheck: Exited with code 0
@dunx/create-app typecheck: Exited with code 0
@dunx/mcp typecheck: Exited with code 0
@dunx/dashboard typecheck: Exited with code 0
@dunx/core typecheck: Exited with code 0
@dunx/http typecheck: Exited with code 0
@dunx/ui typecheck: Exited with code 0
@dunx/auth typecheck: Exited with code 0
@dunx/example-minimal typecheck: Exited with code 0
@dunx/openapi typecheck: Exited with code 0
@dunx/example-testing typecheck: Exited with code 0
@dunx/infra typecheck: Exited with code 0
@dunx/dashboard-ui typecheck: Exited with code 0
@dunx/openapi-ui typecheck: Exited with code 0
@dunx/example-databases typecheck: Exited with code 0
@dunx/example-full typecheck: Exited with code 0
@dunx/bench typecheck: Exited with code 0
@dunx/docs typecheck: docs: 10 packages, 572 public / 714 exported symbols, 24 guides, 64 benchmark cells
@dunx/docs typecheck: Exited with code 0
```

`bun run test`, exit 0, 1631 tests:

```
@dunx/ui test: Ran 7 tests across 1 file. [34.00ms]                 Exited with code 0
@dunx/transform test: Ran 21 tests across 1 file. [66.00ms]         Exited with code 0
@dunx/testing test: Ran 24 tests across 2 files. [147.00ms]         Exited with code 0
@dunx/dashboard-ui test: Ran 9 tests across 1 file. [352.00ms]      Exited with code 0
@dunx/mcp test: Ran 52 tests across 3 files. [444.00ms]             Exited with code 0
@dunx/dashboard test: Ran 33 tests across 3 files. [459.00ms]       Exited with code 0
@dunx/create-app test: Ran 75 tests across 5 files. [652.00ms]      Exited with code 0
@dunx/openapi-ui test: Ran 15 tests across 2 files. [981.00ms]      Exited with code 0
@dunx/openapi test: Ran 101 tests across 10 files. [1.58s]          Exited with code 0
@dunx/auth test: Ran 50 tests across 8 files. [1.60s]               Exited with code 0
@dunx/core test: Ran 155 tests across 17 files. [2.98s]             Exited with code 0
@dunx/infra test: Ran 534 tests across 32 files. [4.11s]            Exited with code 0
@dunx/example-databases test: Ran 5 tests across 1 file. [218.00ms] Exited with code 0
@dunx/http test: Ran 395 tests across 37 files. [4.83s]             Exited with code 0
@dunx/bench test: Ran 23 tests across 2 files. [37.00ms]            Exited with code 0
@dunx/example-minimal test:                                        Exited with code 0
@dunx/example-testing test: Ran 8 tests across 2 files. [158.00ms]  Exited with code 0
@dunx/example-full test: Ran 36 tests across 5 files. [6.39s]       Exited with code 0
@dunx/docs test: Ran 88 tests across 9 files. [11.70s]              Exited with code 0
```

New tests: `packages/core/src/di/module-compose.test.ts` (11),
`packages/core/src/di/teardown.test.ts` (6),
`packages/http/src/throttle/throttle.test.ts` (17),
`packages/http/src/ws/middleware.test.ts` (14),
plus 7 in `packages/infra/src/pagination/pagination.test.ts`.

`bun run lint:check`, exit 0 - 20 warnings, every one pre-existing
`await-thenable`/`no-floating-promises` in test files:

```
$ oxlint .
packages/infra/src/schedule/registry.ts:239:32: warning typescript(no-base-to-string) ...
packages/infra/src/queue/module.test.ts:124:13: warning typescript(no-misused-spread) ...
packages/infra/src/schedule/schedule.test.ts:159:11: warning typescript(await-thenable) ...
packages/infra/src/schedule/schedule.test.ts:160:11: warning typescript(await-thenable) ...
(exit 0)
```

`bun run format:check` is clean for every file this workstream touched. It still
fails on seven `docs/*.md` files, which belong to the concurrent documentation
workstream and were deliberately not touched here.
