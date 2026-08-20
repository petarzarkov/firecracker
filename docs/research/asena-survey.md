# Asena (AsenaJs) — survey, and what dunx could take

Source research relayed by workstream 08 and persisted here so it survives an API
blip. Version **0.10.1**, MIT, default branch `master`, `engines: bun >= 1.3.12`.
95 stars, 221 commits, effectively single-author, actively developed (main repo
2026-08-16, satellites 2026-08-19). **0.x, no stability guarantee.**

Claims below are marked VERIFIED where the agent read source or docs, and
INFERRED / COULD NOT DETERMINE where it did not. That distinction is the point of
the document - do not promote an inference to a fact when acting on this.

## The one thing to read first

Asena's stated non-goal, quoted from <https://asena.sh/raw/philosophy.md>:

> Asena will not run on Node.js. In exchange, it does not pay the abstraction tax
> that portability demands.

That is dunx's bet too, which is why the comparison is worth making at all.

## Dependency injection — the sharpest contrast

VERIFIED. `reflect-metadata: ^0.2.2` is the framework's **only** runtime
dependency, consumed through the non-global entry (`reflect-metadata/no-conflict`
in `lib/utils/typedMetadata.ts`), so global `Reflect` is not patched. Docs require
**both** `experimentalDecorators` and `emitDecoratorMetadata`.

Injection is **field-based with an always-explicit token**:

```ts
@Service()
export class UserService {
  @Inject(UserRepository)
  private userRepo: UserRepository;
}
```

Field over constructor injection is deliberate - "it keeps constructors free for
real initialization". Container storage is string-keyed:
`private _services: { [key: string]: ContainerService | ContainerService[] }`.

INFERRED, not confirmed: `emitDecoratorMetadata` looks functionally unnecessary -
neither `Inject.ts` nor `componentUtils.ts` reads `design:type` or
`design:paramtypes`, but the whole repo was not grepped.

**Circular dependencies are NOT auto-resolved.** No `forwardRef` or thunk
equivalent; `lib/ioc/CircularDependencyDetector.ts` exists and the documented
remedy is to refactor through a shared service, or to mediate via "Ulak".

**dunx is ahead here and should not move.** dunx has no reflect-metadata at all,
takes constructor parameter types from the `@dunx/transform` preload, and resolves
cycles for free because a dependency is a thunk. Asena needs an explicit token at
every injection site precisely because it has no equivalent of the transform.

## Modules — Asena has none

VERIFIED. A flat global registry, no module concept. Registering decorators:
`@Controller`, `@Service`, `@Middleware`, `@WebSocket`, `@Schedule`, `@Config`,
`@Component`, `@EventService`, `@PostProcessor`, plus `@Repository`/`@Database`
from the drizzle package.

Three discovery paths in `lib/ioc/IocEngine.ts`: a runtime filesystem scan of
`sourceFolder`, a global decorator registry keyed on entry files, and an explicit
`searchAndRegister(components)` list.

Scopes are `SINGLETON` (default) and `PROTOTYPE` only. COULD NOT DETERMINE a
request scope; `ContainerService` carries a plain `singleton` boolean, which
suggests none exists.

Relevant to firecracker's own module complaints: a flat registry is not the answer
for an app that needs `global: true` to mean something, or that needs one graph for
the server and a different graph for a job child. Asena would have no way to
express `JobsModule`.

## Middleware — one primitive, no guards or pipes

VERIFIED. `@Middleware()` on a class extending `MiddlewareService` with
`handle(context, next)`. Three attach levels: a `globalMiddlewares()` **method** on
the single `@Config` class (a property is silently never read - a real footgun),
controller-level, and route-level.

Documented order is symmetric:
`globalMiddlewares() -> Controller -> Route -> Handler -> Route -> Controller -> globalMiddlewares()`.
Halt by `return context.send(...)`, `return false` (403), or `throw HttpException`.

No guards, interceptors or pipes as separate concepts - validators are just
`@Middleware({ validator: true })`. **dunx already made this call**, so this is
convergent design rather than something to borrow.

## WebSockets — the strongest idea to take

VERIFIED. `@WebSocket({ path, name, middlewares? })` on a class extending
`AsenaWebSocketService<T>`, with `onOpen`/`onMessage`/`onClose`. Bun's native
WebSocket underneath, and `serveOptions()` exposes raw `wsOptions`
(perMessageDeflate, idleTimeout, backpressureLimit).

Rooms and pub/sub are **first-class**, quoted:

> Asena provides automatic room management with built-in pub/sub pattern. You don't
> need to manually manage `Map<string, Socket[]>`

API: `ws.subscribe/publish/unsubscribe`, `this.to(room, data)`, `this.in(data)`,
`this.sockets`. Key semantic worth stealing exactly: **`ws.publish()` excludes the
sender; `this.to()`/`this.in()` include everyone.** That distinction is one
firecracker currently hand-rolls.

Multi-pod is a `WebSocketTransport` interface - `BunLocalTransport` by default,
`RedisTransport` from `@asenajs/asena-redis`. This is the same shape as
firecracker's `EventsPublisher` with its `socket`/`relay` split, arrived at
independently, which is decent evidence the design is right.

"Ulak" is their DI-cycle workaround: `@Inject(ulak('/path'))` gives a service a
mediator so it can broadcast without injecting the socket class. dunx does not need
it - thunks already resolve the cycle.

## Validation — where Asena is clearly worse

VERIFIED. Zod v4+, required. Schemas are **methods on a separate decorated class
per route**:

```ts
@Middleware({ validator: true })
export class CreateUserValidator extends ValidationService {
  json() {
    return z.object({ name: z.string().min(3), email: z.string().email() });
  }
}
```

Bound with `@Post({ path: '/', validator: CreateUserValidator })`. Fully opt-in; a
route without `validator` skips validation entirely.

One sharp edge documented and worth knowing: "When a route declares a `json`
validator, `context.getBody()` returns the schema's **output**" - the value Zod
produced, not what the client sent.

**dunx's inline schemas on the route decorator are better.** A whole class per route
is the biggest ergonomic cost in Asena.

## Routing and adapters

VERIFIED. A real `AsenaAdapter` abstraction with
`registerRoute(method, path, handler)`. Two official adapters in separate repos:

| Adapter                 | Underneath                                 | Portable | README benchmark |
| ----------------------- | ------------------------------------------ | -------- | ---------------- |
| `@asenajs/ergenecore`   | `Bun.serve()` + native Bun APIs, zero deps | Bun only | 294,962 req/s    |
| `@asenajs/hono-adapter` | Hono, whose router does the matching       | Node too | 233,182 req/s    |

Their comparison numbers: bare Hono 266,476; NestJS-on-Bun 100,975;
NestJS-on-Node 88,083. Treat vendor benchmarks accordingly.

Factory shapes differ awkwardly - ergenecore returns the adapter alone, Hono
returns a tuple `[adapter, logger]`.

Ergenecore's matching is delegated per its own claim ("Leverages Bun's
SIMD-optimized routing engine"); NOT confirmed against ergenecore source, and no
radix-tree or regex implementation is documented for either adapter. dunx's "no
JavaScript router" position is the same bet.

## CLI — and the manifest idea

VERIFIED, and this is the second idea worth taking. `@asenajs/asena-cli` provides
`create`, `generate`/`g`, `dev start`, `build`, `init`.

`asena build`, quoted verbatim:

> 1. Reads asena-config.ts 2. Scans source folder for controllers, services,
>    middlewares, configs, and websockets 3. Generates a temporary build file with all
>    imports 4. Bundles the application using Bun's bundler 5. Outputs compiled files
>    to buildOptions.outdir

Config is **`asena-config.ts`**, a TypeScript file - not a JSON rc file - plus an
auto-generated `.asena/config.json` holding `{"adapter":"hono","suffixes":true}`.

INFERENCE worth flagging: the manifest exists because the runtime
`getAllFiles(sourceFolder)` scan **cannot work inside a bundle**, so dev uses
scanning and prod uses codegen - two strategies that must agree. That is a class of
bug dunx avoids entirely by having no scan.

Gotchas: a build step **is** required for production; and `asena dev start` builds
**once and does not watch** - hot reload is plain `bun run --hot`.

## Documentation — take the delivery mechanism

VERIFIED, and this is the single most directly applicable idea. A real docs site at
<https://asena.sh> (separate repo), with **plain-markdown mirrors at
`https://asena.sh/raw/<page>.md`, indexed by `llms.txt` and `llms-full.txt`**.

~40 pages: Docs (philosophy, get-started, examples, showcase, roadmap), Concepts
(17), Adapters (3), Official Packages (6), CLI (6), Guides (3), Testing (5).
Candid about sharp edges, which is unusual and good.

Weaknesses: no generated API reference; drift between pages (`this.to` vs
`this.server.to` in the WebSocket examples); npm/README still says docs are in
progress.

## Testing utilities — third idea worth taking

VERIFIED. `@asenajs/asena/test` ships `mockComponent` (auto-mocks injected deps by
**reading IoC metadata**), `mockComponentAsync`, `createWebTest` (real routing and
validation, mocked services), and `createTestApp` (real container, `overrides`,
returns a disposable for `await using`). All on Bun's native test runner.

`mockComponent` reading the container's own metadata to build the mock is the neat
part, and dunx has the transform records to do the same thing more cheaply.

## Everything else, briefly

- **OpenAPI**: `@asenajs/asena-openapi`, spec 3.1 derived from the Zod validators
  via `z.toJSONSchema()`, `@Hidden()` to exclude. dunx has `@ApiHidden()` already.
- **Config and errors**: exactly one `@Config` class with `serveOptions()`,
  `onError()`, `onNotFound()`, `globalMiddlewares()`. `HttpException(status, body,
options?)`, and use `isHttpException()` **not** `instanceof`.
- **Events**: in-process only, `@EventService`/`@On`, wildcards, fire-and-forget.
- **Schedules**: `@Schedule({cron})` validated at decorator-eval time by
  `Bun.cron.parse()`, so a bad cron **blocks boot**. Nice. But COULD NOT DETERMINE
  any clustering or distributed-lock story - none is documented, which is the same
  gap firecracker has.
- **Ecosystem**, separate repos, 3-10 stars each: asena-logger, asena-drizzle
  (`@Database`, `@Repository({table, databaseService})`, and a `BaseRepository` -
  directly relevant to firecracker workstream 04), asena-otel, asena-redis,
  asena-kafka.

## Ergonomics deltas vs dunx

|            | dunx                                   | Asena                                 |
| ---------- | -------------------------------------- | ------------------------------------- |
| Metadata   | no reflect-metadata, transform preload | reflect-metadata, two tsconfig flags  |
| Injection  | constructor, types inferred            | field, always-explicit token          |
| Modules    | yes, with `global: true`               | none, flat registry                   |
| Cycles     | self-resolve via thunks                | must refactor, or mediate via Ulak    |
| Validation | zod inline on the route decorator      | a `ValidationService` class per route |
| Build      | none needed                            | required for production               |

## Recommendation, ranked by value for effort

1. **The `llms.txt` + `/raw/*.md` docs mirror.** Cheap, mechanical, and it makes the
   framework legible to exactly the agents that will be asked to write against it.
   Highest value per hour of the three by a wide margin.
2. **First-class WebSocket rooms and pub/sub**, with the sender-exclusion semantic
   spelled out. firecracker hand-rolls this today, which is evidence of the gap.
3. **Container-metadata-driven test mocks.** dunx's transform records already hold
   what `mockComponent` reads reflect-metadata for.

**Rejected most confidently: field injection with explicit tokens.** It is a
downgrade dressed as a feature. It exists because Asena has no transform, and
adopting it would throw away the one thing that makes dunx's DI quieter than
NestJS's. The flat no-module registry is rejected for the same kind of reason -
firecracker's `AppModule`/`JobsModule` split could not be expressed in it at all.
