# Workstream 08 - dunx documentation rewrite, and an Asena survey

dunx 2.1.1, branch `feat/firecracker-driven-gaps`. Documentation only: everything
written is under `docs/**` plus `README.md`. No source file was touched.

Every claim below was checked against `packages/*/src` and, where a contract was
subtle, against the `*.test.ts` beside it. Where a doc and the code disagreed I
recorded it rather than quietly rewording the prose over it, because several of these
are code defects rather than writing defects.

Three repo gates run over documentation and all three are green after every edit
below: `scripts/no-slop.test.ts` (prose voice budgets per file mode),
`scripts/no-em-dash.test.ts`, `scripts/doc-links.test.ts`.

---

## 1. DOCS-VS-CODE DISCREPANCIES

This is the important section. Ranked within each group by how much it costs a reader.

### 1a. Wrong in a way that produces a bug or a boot error

| # | Where | Doc claims | Code does | Evidence |
| - | ----- | ---------- | --------- | -------- |
| D1 | `guide/15-queues.md` | Consuming is a "deliberate second step": `WorkerFactory.create` in its own process, or `WorkerFactory.attach`. `QueueModule.forRoot()` "opens no worker and consumes nothing". | `QueueModule.forRoot({ consume: true })` exists and is the primary path. It binds `QueueRunner`, which implements `OnInit`/`OnShutdown`, so workers start and stop with the container. The guide never mentions the option. | `infra/src/queue/module.ts`, `infra/src/queue/runner.ts` |
| D2 | `guide/15-queues.md` | `examples/full` "has a `bun run worker`" and `src/worker.ts` is the worked example the page is drawn from. | Neither exists. `examples/full` has no `worker` script and no `src/worker.ts`; it uses `consume: true` in `src/jobs/jobs.module.ts` plus `src/jobs/jobs.processor.ts`. | `examples/full/package.json`, `examples/full/src/jobs/` |
| D3 | `guide/07-lifecycle.md` | A throwing `onShutdown` is "logged to `console.error`, exit code 1, **drain continues**". | The teardown loop is unguarded. The first throwing `onShutdown` aborts it: every provider behind it in reverse order keeps its resources and `app.closed` never resolves. | `core/src/di/app.ts`, `core/src/di/shutdown-hooks.ts` |
| D4 | `guide/04-modules.md` | Resolution step 4: "if the token is a class **nothing visible binds**, it self-binds into M's scope." | The self-bind test is graph-wide, not visibility-wide. A class another module declares but does not export to M is a boot error naming that module. Documenting it the other way tells a reader to expect a silent second instance where they will actually get a boot failure, and vice versa. | `core/src/di/scope.ts`, `core/src/di/injector.ts` |
| D5 | `guide/07-lifecycle.md` | `RequestContext` is read with `this.context.get('requestId')`. | There is no `get`. The methods are `getContext()` / `updateContext()`. The example does not compile. | `core/src/logger/context.ts` |
| D6 | `guide/07-lifecycle.md` | Async factory example: `useFactory: (config: AppConfigService) => ...` against `inject: [ConfigService]`. | Rejected by the compiler. Parameters are contravariant and the token carries no type argument, which is exactly why `ConfigModule.forRoot({ as })` exists. `inject` must name the subclass. | `core/src/config/module.ts`, `core/src/config/service.ts` |
| D7 | `guide/03-providers.md`, `guide/07-lifecycle.md` | An override naming a token nothing binds always throws. | Only a **non-class** token throws. A class (or abstract class) token nobody bound is accepted and registered lazily, because a class self-binds on demand anyway. The check is `typeof token === 'function'`. A reader relying on the documented error to catch a typo'd class override gets silence. | `core/src/di/app.ts` |
| D8 | `guide/01-introduction.md` | "You want MySQL or MariaDB through the ORM integration. There is **no drizzle path for either on Bun at all**." | `SqlOptions` rejects a non-Postgres URL and its own error message names the path that works: `drizzle-orm/mysql-proxy` over `Bun.SQL`, needing no change to the package. `examples/databases/src/mysql/` ships a working `DbOptions` for it, and the README advertises MySQL. The guide talked a reader out of something that ships. | `infra/src/db/sql/options.ts`, `examples/databases/src/mysql/driver.ts` |
| D9 | `README.md` | One line in `bunfig.toml` turns constructor types into wiring, showing only top-level `preload`. | Two entries are needed. Bun's test runner reads its own `preload`, so without `[test] preload` the app runs and `bun test` fails at the first provider with a constructor parameter. The scaffold writes both; the missing-transform error message prints both. | `tools/create-app/templates/base/_bunfig.toml`, `core/src/di/transform-hint.ts` |

### 1b. Stale: the code grew a feature the doc still calls absent

| # | Where | Doc claims | Code does |
| - | ----- | ---------- | --------- |
| D10 | `MIGRATION-FROM-NEST.md` | `@nestjs/schedule` (`@Cron`) maps to "bullmq repeatable jobs", status **undesigned**. | `@dunx/infra/schedule` ships `@Cron`, `@Interval`, `@OnceOnBoot`, `ScheduleRegistry.add()`, `CronExpression`, `Overlap`, `supportsTz`. This is the single most misleading row in the doc a migrating app reads first. |
| D11 | `MIGRATION-FROM-NEST.md` | `@nestjs/terminus` maps to "-", status **undesigned**. | `HealthModule` ships in `@dunx/http` with `HealthRegistry`, `Readiness`, and `Database`/`Disk`/`Memory`/`Redis` indicators plus a `critical` flag. |
| D12 | `MIGRATION-FROM-NEST.md` | `createParamDecorator` (`@CurrentUser`) has "**no successor designed**", and proposes a hypothetical `Ctx<{ user: User }>` second parameter. | The pattern that shipped is an injected service reading async context: `@dunx/auth`'s `AuthContext`. The proposed API does not exist and reads as if it might. |
| D13 | `docs/ARCHITECTURE.md` | Index describes the DI page as covering "why modules do **not** encapsulate". | Modules encapsulate. The page it points at has a section headed "Modules encapsulate: `exports`, `global`, and a scope each". The index contradicted its own target. |
| D14 | `docs/research/README.md` | Verdict table: `scheduler` = "build", blocked on the discovery walker moving to core. `health` = "build", blocked on `OnDrain` in `@dunx/core`. | Both delivered. `markedMethods` is exported from `@dunx/core`; the hook shipped and was renamed `OnBeforeShutdown` in 2.1.1. |
| D15 | `docs/research/README.md` | Live defect 1: `ClientAddress` takes `.split(',')[0]`, the spoofable leftmost `X-Forwarded-For` entry. | Fixed. `trustedHops` counts from the right, `true` means one proxy, and a count longer than the header clamps to the leftmost entry. This was `throttle`'s stated blocker, so the blocker column was stale too. |
| D16 | `docs/research/README.md` | Live defect 2: `@dunx/mcp` drops JSON-RPC batches, answering an array as a notification. | Fixed. `protocol.ts` has a `rejection()` step ahead of the notification check that answers an array with `-32600` naming the protocol revision. |
| D17 | `guide/03-providers.md`, `guide/07-lifecycle.md` | "Two hooks." | Three: `OnInit`, `OnShutdown`, `OnBeforeShutdown`. The third is the one a graceful-shutdown reader needs, and it was unnamed on both pages. |
| D18 | `docs/ROADMAP.md` | Built table: `@dunx/infra` = `/db /redis /files /images /logger`. | Also `/queue`, `/schedule`, `/pagination`. Three shipped subpaths absent from the list of what is built. |
| D19 | `README.md` | "The guide - eighteen pages". | Twenty-one. |
| D20 | `guide/01-introduction.md` | Throughput and startup tables dated 2026-08-02. | The current report is 2026-08-03 and every figure moved. The README quoted the current run while the guide quoted the previous one, so the front door and the introduction disagreed by about 2%. Notably plaintext is now 100.4% of raw `Bun.serve`, which the guide's own prose calls the noise case. |
| D21 | `guide/03-providers.md` | Eager resolution "instantiates every provider". | Every **declared binding**. A self-binding class and the promoted `Logger`/`RequestContext` defaults are built on first `get`, so a provider nothing asks for never gets an `onInit` or an `onShutdown`. |
| D22 | `guide/04-modules.md` | `forRootAsync` "ships on `LoggerModule`, `ImagesModule`, `RedisModule`, `FilesModule` and `DbModule`". | Thirteen modules have one, including `QueueModule`, `ScheduleModule`, `AuthModule`, `OpenApiModule`, `HealthModule`, `HttpClientModule`, `StaticModule`, `DashboardModule`. |

### 1c. Wrong name, signature or quoted output

| # | Where | Doc claims | Code does |
| - | ----- | ---------- | --------- |
| D23 | `guide/04-modules.md` | "An entry in either list is a bare class or a `Registration` from `provide()`." | Only `providers` admits a `Registration`. `controllers` is typed as bare classes. |
| D24 | `guide/04-modules.md` | Quotes the unresolvable error as `Cannot resolve UsersRepository **for ReportsService** in module "ReportsModule"`. | The consumer clause appears only for a `token()` dependency. For a class token the container re-raises the original message, which has no `for` clause. |
| D25 | `guide/04-modules.md` | "`examples/full` - 16 modules". | Miscounted, and a number that goes stale on every feature added. Replaced with a description. |
| D26 | `guide/04-modules.md` | `HttpFactory`'s wrapper module binds `PubSub` and `RequestLoggingMiddleware`. | Also `ClientAddress`, and that binding is load-bearing: unbound, it self-binds into whichever scope asks first, so `listen()` attaches the live server to one instance while another module's middleware injects a second, and `app.clientIp(req)` throws on the one that never got a server. |
| D27 | `guide/03-providers.md` | Quotes the `inject()` misuse error truncated. | The real message ends "...because that is what decides which module scope the token resolves from." |
| D28 | `guide/03-providers.md` | The missing-transform failure always prints the `bunfig.toml` snippet. | It branches on `Bun.main`. A `.js`/`.cjs`/`.mjs` entrypoint gets a different message saying the tree is prebuilt and printing the `Bun.build({ plugins: [depsPlugin] })` fix, because the plugin filter is `/\.tsx?$/` and no preload setting can make it match emitted JS. |
| D29 | `guide/03-providers.md` | `HttpApp.shutdown()` "stops the server first, then closes `PubSub`, then delegates". | It runs `drain()` first, then stops the server, then `PubSub`, then the container. The drain-before-close ordering is the whole reason a readiness probe can fail while the port is still open. |
| D30 | `guide/07-lifecycle.md` | `app.get(Token, Module)` is "resolved from one module's scope". | It prefers that module's view, then falls back to the root scope, then to the single module declaring the token, then self-binds a class into the module named. A module absent from the graph throws. |

### 1d. Internal contradictions

| # | Where | The contradiction |
| - | ----- | ----------------- |
| D31 | `MIGRATION-FROM-NEST.md` | The Ecosystem table says `@nestjs/websockets` + socket.io maps to "gateways on `Bun.serve`", status **done**. Two sections later, "Out of scope" says "A `@dunx/ws` is plausible", as if none existed. Gateways ship in `@dunx/http`. |
| D32 | `MIGRATION-FROM-NEST.md` | Status legend defines **planned** = "designed in ARCHITECTURE.md, unbuilt". No row uses it. |
| D33 | `MIGRATION-FROM-NEST.md` | "Out of scope" lists `app.set('trust proxy')` as having no equivalent. `AppSettings` declares exactly one key and it is `'trust proxy'`, with hop counting. |
| D34 | `MIGRATION-FROM-NEST.md` | Cites `dunx-template` as "a running parity app" and the acceptance test. Nothing in the repo references such a workspace; the acceptance target named everywhere else is the external `nestjs-template`. Unverified, and reads as if a reader could go look at it. |

### 1e. The HTTP layer (audited last, and the richest seam)

| # | Where | Doc claims | Code does | Evidence |
| - | ----- | ---------- | --------- | -------- |
| D35 | `guide/05-controllers.md` | An unmatched **method** returns a native 404, "Bun's native behaviour, unmodified", so "there is no fall-through for an `OPTIONS` request to land in". | dunx always passes a `fetch` fallback to `Bun.serve`, and Bun routes a method miss to `fetch` whenever one exists. A method miss therefore runs the whole global chain, and an `OPTIONS` request **does** fall through. Guide 08's own table says so, so the two pages contradict each other. The real reason preflight is mounted per path is that the fallback holds no route patterns and cannot know a path's verbs. | `server/application.ts:323-341`, `server/routes.ts:169-195`. The same wrong claim sits in a test comment at `server/server.test.ts:236-238`. |
| D36 | `guide/05-controllers.md`, `guide/08-middleware-and-guards.md` | The fallback returns `{"error":"NOT_FOUND","status":404}`. | Only under `notFound: 'public'`, or with no refusing global middleware. The **default is `'guarded'`**: the miss carries no route metadata, so a global auth guard refuses it and the caller gets **401**. Neither page mentions `HttpOptions.notFound` or the `UNMATCHED` key. This is the single most likely doc-driven surprise in the HTTP layer, and firecracker's own notes repeat the 404 claim. | `server/application.ts:129-148`, `server/routes.ts:144-155`, `server/notfound-guard.test.ts:70-86` |
| D37 | `guide/08-middleware-and-guards.md` | The request id "comes back on the response header" in every case but one. | Stamped only on the success path and the `correlateIgnored` path. A guard's 401, a validation 400, a mapped 500 and every fallback 404 carry **no** `x-request-id`, because `#failed` rethrows and the error mapper builds a fresh `Response`. No test covers it, so this is plausibly a code defect rather than a doc defect. | `server/request-logging.ts:322, 337, 392, 403`, `server/routes.ts:314-320` |
| D38 | `guide/06-validation.md`, `guide/09-websockets.md`, `architecture/http.md` | `@dunx/http` has "zero dependencies" and "depends only on `@dunx/core`". | It has one runtime dependency, `@arkv/shared` ^0.8.0, used by the outbound client behind `./client`. Three pages assert the old fact. | `packages/http/package.json` |
| D39 | `guide/09-websockets.md` | `SocketData` is `{ path, context }`. | `{ path, context, id }`. `id` is a per-connection `crypto.randomUUID()` minted at the upgrade, and it is the field anyone correlating socket logs wants. | `ws/socket.ts:8-17`, `ws/adapter.ts:344-350` |
| D40 | `guide/08-middleware-and-guards.md`, `guide/05-controllers.md` | `'trust proxy'` is a boolean that "makes `ClientAddress` read `X-Forwarded-For`". | It is `boolean \| number`, a **hop count**, and the address is taken that many entries from the **right**. Documenting it as a boolean toggle is what produces the spoofable deployment the research record logged as a defect and the code then fixed. | `server/settings.ts:6-18`, `server/client-address.ts:13-17, 50-62` |
| D41 | `architecture/http.md` | Route discovery step 2 reads `Object.entries(instance)` for field-initialised `route.*` builders, and "decorated methods and field routes are one merged set". | Not implemented. `discoverRoutes` walks the prototype chain only. The same page admits this 90 lines earlier, so it contradicts itself. | `route/discover.ts:62-79` |
| D42 | `guide/08-middleware-and-guards.md` | The request-logging options table has four rows. | Seven options exist. Missing: `ignorePrefix`, and `correlate` (default `true`; setting it `false` drops the `AsyncLocalStorage` scope, so every handler log line silently loses its request id). | `server/request-logging.ts:37-88` |
| D43 | `guide/08-middleware-and-guards.md` | `requestBody`/`responseBody` cost "a `req.clone().text()` per request". | Only for non-GET/HEAD requests whose `content-type` includes `application/json`. Urlencoded, multipart and text bodies are never logged even with the flag on, which is a behaviour gap the cost note hides. | `server/request-logging.ts:413-436` |
| D44 | `guide/08-middleware-and-guards.md` | The `ErrorFilter` example. | Does not compile. `ErrorFilter` is abstract and a subclass constructor must call `super()`. | `server/errors.ts:81-83` |
| D45 | `guide/20-health-checks.md` | The `BrokerIndicator` example. | Does not compile. It uses `this.broker`, which the class never declares or injects. | `health/contracts.ts:24-35` |
| D46 | `guide/09-websockets.md` | A plain `GET` on a gateway path is 426 "because the upgrade was refused **by Bun**". | The 426 is dunx's own `Response`, returned when `server.upgrade()` answers false. |  `ws/adapter.ts:337-354` |
| D47 | `guide/09-websockets.md` | Three gateway boot errors: handler collision, no handlers, two gateways on one path. | A fourth exists and is undocumented: a provider declaring `@OnMessage`/`@OnOpen` **without** `@Gateway` is a boot error naming the method. | `ws/discover.ts:101-109` |
| D48 | `guide/09-websockets.md` | `websocket.onError` "defaults to `console.error` with the gateway path in the line". | The `console.error` default installs only when there is no socket middleware, and the factory installs one by default, so in a factory-built app failures go through `Logger` instead. Note: this touches the file a colleague is editing, so I did not correct it. | `ws/adapter.ts:236-238`, `ws/socket.ts:47-54` |
| D49 | `guide/06-validation.md` | `z.toJSONSchema(schema, { io: 'input', ... })`. | `io` is a parameter, `'input'` for request schemas and `'output'` for `response` schemas. | `openapi/src/convert.ts:103-135` |
| D50 | `guide/05-controllers.md` | The `RouteSchemas` block. | Omits `response`, which guide 06 documents. Worth stating because `response` is documented-but-never-validated, and a reader meeting it only in the OpenAPI guide may assume it enforces. | `route/schema.ts:43-69` |
| D51 | `guide/08-middleware-and-guards.md`, `guide/09-websockets.md` | - | Six `HttpOptions` keys these two pages own are never mentioned anywhere: `notFound`, `socketMiddleware`, `socketLogging`, `bootLogging`, `relayResubscribe`, `port`. | `server/application.ts:44-148` |
| D52 | `guide/02-first-steps.md` | The scaffold feature table lists a `dashboard` feature (bull-board at `/queues`, requiring `jobs`). | No such feature exists. `FEATURES` has thirteen entries and `dashboard` is not one, so `--with dashboard` fails. Two `Pulls in` cells are also wrong: `websockets` requires `cache`, and `health` requires `files` as well as `cache` and `database`. | `tools/create-app/src/features.ts` |

**A firecracker-relevant correction.** firecracker's own notes say socket handlers
"**send** their acks rather than returning them" because "dunx replies to
`@OnMessage('x')` under the name `x`, and a request and its acknowledgement are not
the same event". The second half is right and the framing is misleading: dunx **does**
auto-reply. A named `@OnMessage('x')` whose return value is not `undefined` has it
sent back to the sender as `{"event":"x","data":...}`, promises settled first; a raw
`@OnMessage()` replies unwrapped. Returning `undefined` sends nothing. So sending acks
explicitly is a **project convention** in firecracker, not a framework requirement,
and anyone reading that note as a description of dunx will be surprised the first time
a handler returns a value. `ws/adapter.ts:264-268`, asserted at
`ws/server.test.ts:181-206`.

**A second one.** firecracker's notes say the websocket upgrade "accepts `?token=`"
and admits anonymous callers. Nothing in `packages/http` reads a `token` query
parameter, and `packages/auth` has no websocket path at all. The only refusal point is
a `Response` returned from `@OnUpgrade`, and a gateway without one admits every caller
unconditionally. Both behaviours are the app's, not the framework's.

### 1f. Confirmed absent, so any doc implying otherwise is wrong

- **There is no throttle or rate limiter anywhere in `packages/**`.** Verified by grep:
  the only hits for `throttle` in `packages/*/src` are inside the two generated
  `ui-bundle.ts` files. `docs/research/throttle.md` is a research verdict, not a
  shipped feature, and `MIGRATION-FROM-NEST.md` correctly reports `@nestjs/throttler`
  as undesigned. Recorded here because firecracker's own notes describe a throttle
  decorator, and that is **the app's**, not the framework's. Anything that reads as a
  dunx throttle is a discrepancy **in 2.1.1 as shipped**.

  Forward note: the concurrent workstream has an untracked `packages/http/src/throttle/`
  directory. When it lands, `MIGRATION-FROM-NEST.md`'s `@nestjs/throttler` row moves to
  done, `docs/research/throttle.md` becomes a delivered verdict rather than an open one,
  and `guide/08-middleware-and-guards.md` gains a section. I documented none of it.

### 1g. Unverified, and left marked as such rather than cut

- `guide/01-introduction.md`'s microsecond decompositions (1.3 us reading headers,
  0.9 us for the `AsyncLocalStorage` scope, 2.1 us building the entry, 0.7 us reading
  `req.url`; 0.27/3.10/0.94 us for body parse and validate) come from
  `architecture/cost-of-logging.md` and `architecture/cost-of-validation.md` rather
  than from `internal/bench/results/latest.json`. I refreshed the throughput and
  startup tables against the current report and left these, because I could not
  re-derive them without running a probe. They are consistent with the surrounding
  prose but are not attributable to a file in the repo.
- `guide/12-configuration.md`, `guide/10-openapi.md`, `guide/13-logging.md`,
  `guide/14-database.md`, `guide/16-scheduling.md`, `guide/17-authentication.md`,
  `architecture/dependency-injection.md`, `architecture/authentication.md`,
  `architecture/packaging.md` and `docs/bun-apis.md` have reported findings I did not
  reach. Named in section 2 under "still to do".
- `MIGRATION-FROM-NEST.md`'s middleware-ordering list is now **verified correct** and
  needs no change. The audited order, outermost first, is: CORS wrapper, error
  mapper or `ErrorFilter`, `RequestLoggingMiddleware`, `HttpOptions.middleware` in
  declared order, `app.use()` in call order, the declaring module's `middleware`,
  class `@UseGuards`, method `@UseGuards`, declared-schema validation, handler, then
  unwind. Pinned by `server/lifecycle.test.ts:188-218`, including the refusal case
  where `log` lands before `filter`.

---

## 2. WHAT I REWROTE, FILE BY FILE

Line counts are before/after. A small delta on a page with a large discrepancy is
deliberate: these were surgical corrections, not re-drafts, because the existing
prose is good and the repo gates its voice.

| File | Lines | What changed and why |
| ---- | ----- | -------------------- |
| `README.md` | 185 -> 196 | The `bunfig.toml` snippet now shows `[test] preload` with one sentence on why (D9) - a reader copying one line got a working app and a broken suite. Guide count 18 -> 21 (D19). Added the `.js`-extension rule to "Three things that are different", because `moduleResolution: nodenext` makes an extensionless relative import a compile error and it is the fourth thing that bites a NestJS arrival. Benchmark tables verified against the current report and left alone: the README was already current. |
| `docs/ARCHITECTURE.md` | 64 -> 65 | Fixed the index entry that described the DI page as explaining "why modules do not encapsulate" (D13). Added the missing `architecture/mcp.md` row; it was the one page absent from its own index. |
| `docs/guide/01-introduction.md` | 218 -> 223 | Throughput table, startup table, request-logging figures and the "~53 ms" aside all refreshed to the 2026-08-03 report (D20). Recast the throughput column as "% of raw" rather than "dunx costs", because with plaintext now at 100.4% a "costs" column has to print a negative number the page's own prose calls noise. Replaced the MySQL paragraph (D8) with what actually happens: two shipped backends, a construction-time rejection with a message naming the working path, and a link to the example that ships one. |
| `docs/guide/03-providers.md` | 479 -> 504 | Corrected the override-of-an-unbound-token claim (D7), the "two hooks" count (D17), the eager-resolution claim (D21), the `inject()` error text (D27), the missing-transform message's second branch (D28), and the shutdown ordering (D29). The prebuilt-tree branch is the addition I would defend hardest: it is the failure mode of anyone who deploys a built tree, and the docs sent them to check the setting that was already correct. |
| `docs/guide/04-modules.md` | 570 -> 592 | Fixed resolution step 4 (D4), the `controllers`/`Registration` claim (D23), the quoted error message (D24), the module count (D25), the wrapper's bindings including why `ClientAddress` must be bound (D26), and the `forRootAsync` list (D22, reflowed into a per-package list to stay under the paragraph budget). |
| `docs/guide/07-lifecycle.md` | 250 -> 275 | Fixed the shutdown-error row, which said the drain continues when it aborts (D3), the `RequestContext` example that does not compile (D5), the async-factory example that does not typecheck (D6), the override claim (D7), the hook count (D17), and `app.get`'s fallback chain (D30). |
| `docs/guide/15-queues.md` | 506 -> 574 | The largest rewrite. Replaced "Publish side and worker side are different processes" with the three consumption paths in a table, `consume: true` first, and why it lives in a module rather than an entrypoint (start/stop ordering against the connections handlers use). Added the per-handler isolation section: `background: true` forks the `processor` file, `processor` must be absolute, `background` is declared per handler but takes effect per queue because bullmq opens one `Worker` per queue, `isolation` is a module option rather than a handler option, and `'thread'` breaks DI because a preload cannot match a `.ts` file inside bullmq's prebuilt worker entry. Fixed the `examples/full` references (D2). Corrected "Which to reach for". |
| `docs/research/README.md` | 236 -> 238 |
| `docs/MIGRATION-FROM-NEST.md` | 259 -> 343 | The page the brief cares most about. Added a "Read this part first" section covering the four boot failures, in order: the two-entry `bunfig.toml` preload plus the prebuilt-tree branch, a constructor parameter having to name a runtime value, decorated-or-configured modules with a two-row table on which spelling to use, and `.js` on relative imports. Then: `@nestjs/schedule` and `@nestjs/terminus` moved from undesigned to done with links (D10, D11); the `createParamDecorator` section rewritten around `AuthContext` and the injected-service pattern in place of a hypothetical `Ctx<>` API that does not exist (D12); the socket.io entry rewritten so it no longer implies gateways are unbuilt (D31); the unused legend entry dropped (D32); `trust proxy` moved out of "Out of scope" (D33); the unverifiable `dunx-template` acceptance app replaced with `examples/full` (D34). Its middleware-ordering table I left alone, having since verified it correct. |
| `docs/ROADMAP.md` | 626 -> 626 | Built table: `@dunx/infra` gained `/queue`, `/schedule`, `/pagination`; `@dunx/http` gained health probes and `./client` (D18). |
| `docs/guide/02-first-steps.md` | 629 -> 628 | Removed the `dashboard` scaffold feature, which does not exist, and corrected two `Pulls in` cells (D52). |
| `docs/guide/05-controllers.md` | 624 -> 629 | `'trust proxy'` rewritten as the hop count it is, with why counting from the right is the safe direction (D40). |
| `docs/guide/06-validation.md` | 436 -> 436 | Dropped the "zero dependencies" claim (D38). |
| `docs/guide/08-middleware-and-guards.md` | 665 -> 666 | `'trust proxy'` corrected to a hop count (D40). |
| `docs/guide/09-websockets.md` | 475 -> 478 | `SocketData` gained its `id` field (D39); the relay's dependency claim corrected (D38). |
| `docs/guide/19-deployment.md` | 196 -> 216 | Replaced the hand-rolled `HealthController` example with `HealthModule.forRootAsync`, and explained the two settings that decide whether a rollout drops requests: `critical` (why only the database usually earns `true`) and `drainDelayMs` (why `OnBeforeShutdown` rather than `onShutdown`, and how to size it against the ingress). |
| `docs/architecture/http.md` | 282 -> 283 | Dropped the "zero dependencies" claim (D38). | Status drift only, no polishing: two verdicts marked delivered, one blocker cleared, two of the six live defects struck through as fixed with what fixed them (D14, D15, D16), and a line at the top of the verdict prose saying the rows now carry that state. |

### Still to do, and why it is not done

`MIGRATION-FROM-NEST.md` is the highest-value page for this audience and I have the
full correction list for it above (D10, D11, D12, D31, D32, D33, D34) but did not get
to the edit. It needs: the schedule and terminus rows moved to done with links, the
`createParamDecorator` section replaced by the injected-service pattern
(`AuthContext`, and firecracker's `CurrentUser` as the app-side shape), the websocket
self-contradiction removed, the unused legend entry dropped, `trust proxy` moved out
of "Out of scope", and the `dunx-template` claim either substantiated or cut. Its
middleware-ordering table must wait for the HTTP audit.

Also outstanding: `guide/12-configuration.md`, `guide/02-first-steps.md` (a
non-existent `dashboard` scaffold feature and some wrong "Pulls in" cells were
reported), `guide/10-openapi.md`, `guide/11-testing.md`, `guide/13-logging.md`,
`guide/14-database.md`, `guide/16-scheduling.md`, `guide/17-authentication.md`,
`guide/19-deployment.md`, `architecture/dependency-injection.md`,
`architecture/authentication.md`, `architecture/packaging.md`, `docs/bun-apis.md`,
and the `docs/ROADMAP.md` Built table (D18).

### Where the concurrent workstream's docs will need to go

A colleague is adding, at the time of writing: a sync path in
`infra/src/pagination/keyset.ts`, `http/src/ws/middleware.ts`, `http/src/ws/logging.ts`,
an untracked `http/src/throttle/`, and changes across `core/src/di/{module,scope}.ts`
and `http/src/server/{application,errors,factory,routes}.ts`. I documented none of it,
and one existing finding (D48, the websocket `onError` default) sits in a file they are
editing, so I left that one uncorrected rather than colliding. When it lands:

- **Pagination sync path**: `guide/14-database.md`, in the section on why repositories
  are synchronous except `list`. That asymmetry exists only because `paginate` had to
  serve `Bun.SQL` too, so a sync keyset path is the thing that removes the exception,
  and the guide's current explanation of it becomes wrong rather than incomplete.
- **Websocket middleware**: `guide/09-websockets.md` needs a new section, and
  `guide/08-middleware-and-guards.md` needs a cross-reference, since "one `Middleware`
  interface" is currently an HTTP-only statement. `MIGRATION-FROM-NEST.md`'s claim that
  guards/interceptors/pipes collapse into one concept should then say whether that one
  concept spans both transports.
- **Websocket logging**: `guide/13-logging.md`, beside `RequestLoggingMiddleware`, and a
  note in `guide/09-websockets.md`. If it is on by default, `HttpOptions` gains a switch
  and `architecture/cost-of-logging.md` gains a measurement.
- **Throttle**: `guide/08-middleware-and-guards.md` gains a section, and
  `MIGRATION-FROM-NEST.md`'s `@nestjs/throttler` row moves off undesigned. Note that
  `docs/research/throttle.md` named `ClientAddress` hop counting as its blocker and
  that blocker has shipped, so the research record's verdict row needs updating too.
- **`core/src/di/{module,scope}.ts`**: if module composition or scope resolution
  semantics changed, `guide/04-modules.md`'s "How a token resolves" list is the first
  thing to re-verify. I corrected step 4 against the current code (D4), so a change
  there invalidates a correction rather than an old error.


---

## 3. WHAT I PROPOSE DELETING

**`docs/research/` should stay.** I was asked to consider it a stale artefact and it is
not one. It is twelve measurement records with reproducers, a verdict table, and a
defect list that has produced real fixes: two of the six defects it lists were fixed
in shipped code and the record is what drove them. Its README had drifted, which I
fixed. Deleting it would throw away the evidence behind refusals that will otherwise
be re-litigated. It is correctly `Exempt` from the prose gate and correctly excluded
from the published site.

**`docs/roadmap/` should shrink to one file.** Three files, and only one is live:

| File | Proposal |
| ---- | -------- |
| `queue-shutdown-sigterm.md` (247 lines) | **Keep.** Two upstream leaks in `Bun.RedisClient` and bullmq's Bun adapter are still open, each with a minimal reproduction ready to file. That is not a plan, it is an asset. |
| `http-options-before-container.md` (24 lines) | **Keep, but it is nearly resolved.** Its `OpenApiModule.forRoot` half is already marked done. What remains is one open question about `HttpOptions` being evaluated before the container. It is the shortest file in the repo and states a real gap. |
| `class-modules-and-opt-in-config.md` (652 lines) | **Split or trim.** It opens by saying W3 and W4 are done and W1, W1b, W2 and W6 are open, which makes roughly half of 652 lines a record of completed work sitting in a directory whose stated contract is "deleted when delivered". Move the delivered findings into `architecture/` and leave the four open items. |

**`HANDOFF.md`** (56 lines, repo root, outside my writable surface) is a context-handoff
scratchpad for an agent session. It is not documentation and does not belong in a
published repo root next to README/CONTRIBUTING/CHANGELOG. Proposing, not doing.

Nothing under `docs/guide/` or `docs/architecture/` should be deleted. Three
constraints make renaming or removing a guide page riskier than it looks, and they are
worth writing down because they are not obvious:

1. `internal/docs/scripts/generate.ts` maps every one of the 21 guide slugs to a nav
   section. A page absent from that map lands in the **last** section, so adding a page
   mid-sequence makes `site.test.tsx`'s "sections are contiguous" assertion fail.
2. `site.test.tsx` asserts `guides.length > 15` and that `loadGuide('testing')`
   contains a `sharp-edges` heading, so `11-testing.md` must keep that heading.
3. `published-voice.test.ts` fails a **published** page that cites `packages/*/src/`,
   `internal/*`, `docs/roadmap`, `CLAUDE.md` or a repo script. That covers all 21
   guides plus `MIGRATION-FROM-NEST.md` and two architecture pages, which is why the
   corrections above cite behaviour rather than file paths.


---

## 4. ASENA SURVEY

[AsenaJs/Asena](https://github.com/AsenaJs/Asena) is the closest thing to a direct
competitor dunx has: an IoC web framework for Bun, decorator-driven, explicitly
positioned against NestJS. Its own description is "bringing Spring Boot's automatic
component discovery and field-based dependency injection to TypeScript".

Read, not run, per instruction. Sources: the [repo](https://github.com/AsenaJs/Asena),
the docs site at [asena.sh/docs](https://asena.sh/docs), the
[get-started](https://asena.sh/docs/get-started) and
[middleware](https://asena.sh/docs/concepts/middleware) pages, the
[roadmap](https://asena.sh/docs/roadmap), and the
[ergenecore adapter](https://github.com/AsenaJs/ergenecore).

**Position.** Asena core is `0.10.1`, 95 stars, and its own roadmap says
"v0.x.x - pre-1.0 releases with breaking changes possible" while answering "yes (with
caution)" on production use. The `ergenecore` adapter is separately versioned at
`3.2.0`. So: younger and smaller than its surface suggests, and further along than
dunx on ecosystem breadth. It ships official Logger, Drizzle, OpenAPI, OpenTelemetry,
Redis and Kafka packages, plus microservices with broker-agnostic messaging, which
dunx has none of.

**The headline number is not comparable.** Asena advertises 294,962 req/s at 1.34 ms
against Hono's 266k. That is 12 threads and 400 connections on a Hello World endpoint.
dunx's harness runs 64 connections on one process and reports 137,539 req/s at 100.4%
of raw `Bun.serve`. Neither number refutes the other and nobody should quote them
side by side.

### The comparison

| Asena idea | How Asena does it | How dunx does it today | Applicable | Why, and what it would cost |
| ---------- | ----------------- | ---------------------- | ---------- | --------------------------- |
| **`emitDecoratorMetadata` DI** | Requires `experimentalDecorators` and `emitDecoratorMetadata` in the consumer's tsconfig. | TC39 standard decorators, `oxc-parser` reading constructor types at load time, no metadata and no tsconfig flags. | **No** | This is the whole reason dunx exists and the answer is not close. dunx's `CLAUDE.md` bans both flags and `reflect-metadata` outright. The costs dunx avoids are concrete: import-order fragility, and a type that degrades to `Object` handing you `undefined` instead of a boot error. Asena needs no preload, which is a genuine ergonomic win, and it pays for it with two compiler flags and a legacy decorator dialect that TC39 will not converge on. |
| **Field injection: `@Inject(Service) private x: Service`** | Property injection, decorated per field. | Constructor injection, unannotated. `inject()` in a field initializer is the escape hatch. | **No** | Naming the token in `@Inject()` sidesteps type erasure entirely, which is why Asena can inject where dunx errors. But it restates the type on every field, makes the dependency invisible to `new`, and makes a class untestable without the container. dunx's boot error is the better trade for a codebase migrating from Nest, where constructor injection is already the shape. |
| **`@Strategy('Name')` + `@Implements('Name')`: inject all implementations of an interface as an array** | A named interface token; every `@Implements` registers under it; `@Strategy` injects the whole set. | No equivalent. Multi-binding does not exist: a token resolves to exactly one instance, and a second declarer in another module is silently a second instance. | **Partly, and this is the best idea in the survey** | dunx already has the ingredients: `token<T>()` gives an identity, and the scope graph knows every declarer. A `tokenSet<T>()` that resolves to `readonly T[]` would answer several real patterns dunx currently makes people hand-roll: health indicators (today an array passed through options), error filters, seeders, job handlers. Cost is real but bounded: a second token kind, a resolution path in `Injector`, an `exports` story, and a decision on ordering across modules. It does not need reflect-metadata and does not touch the transform. |
| **`@OnStart` / `@OnStop` as decorators on any method** | Method decorators, discovered by scan. | Structural interfaces: implement `onInit` / `onShutdown` / `onBeforeShutdown` and the container finds them. | **No** | dunx's version is strictly better for this codebase: one method name per phase, checked by `implements`, no marker to forget, and it composes with inheritance. Asena's is more flexible (several hooks per class) at the cost of making the lifecycle invisible in the type. |
| **Pluggable HTTP adapters (Ergenecore native Bun, or Hono), swappable without touching business logic** | An adapter interface; `createErgenecoreAdapter()` handed to `AsenaServerFactory.create`. | `Bun.serve({ routes })` directly, no adapter seam. | **No** | The adapter abstraction is what forces Asena to ship its own `Context` type, which is the layer dunx deliberately does not have. dunx's whole performance claim is "the gap to raw `Bun.serve` is dunx overhead and nothing else", which only stays measurable because there is one path. Adding an adapter seam would cost the thing the README leads with. Worth noting the irony: Asena's own fast adapter is the one that drops Hono and calls `Bun.serve` directly. |
| **Zod validation at route, controller **or global** level** | Integrated Zod with automatic error handling, attachable at three levels. | Standard Schema on the route decorator only. Validator-agnostic, so Valibot and ArkType work too. | **Partly** | Controller-level and global-level schema defaults are a real gap: a dunx app that wants the same `params` schema on eight routes writes it eight times. Worth taking as inheritance of the route decorator's schemas from `@Controller`, which is cheap. Global validation is not worth taking, and Asena's Zod coupling is a step backwards from Standard Schema. |
| **`context.send()` and `HttpException`, plus `return false` from middleware meaning 403** | Three ways to stop a middleware chain. | Throw `HttpError`, or return a `Response`. | **No** | `return false` meaning 403 is a magic value that cannot say why. dunx's thrown-error path already carries a status and a code, and the error mapper is one extension point rather than three conventions. |
| **Websocket namespaces and rooms** | `AsenaWebSocketService` with `onOpen`/`onMessage`/`onClose` and namespace/room management. | `@Gateway` per path, `PubSub` topics, and a relay for multi-node. | **Partly** | dunx has the mechanism (topics) but not the vocabulary. "Rooms" is the term every socket.io migrant searches for, and firecracker had to build lobby and DM fan-out on raw topics. A thin `rooms` helper over `PubSub` would be documentation as much as code. Low cost, real migration value. |
| **A real CLI: `asena create`, `asena init`, `asena dev start`, `asena build`, with an `asena-config.ts`** | Scaffolds, configures a build, runs a dev server, and produces `dist/index.asena.js`. | `bunx @dunx/create-app` scaffolds and stops. No dev-server command, no build command, no config file. | **Partly** | The scaffolder is comparable and dunx's composable feature folders are arguably better. What dunx lacks is `build`: it has a documented `Bun.build({ plugins: [depsPlugin] })` recipe for recording dependencies ahead of time, and that recipe is exactly the thing every user must get right to deploy a compiled tree. A `dunx build` that encapsulated it would remove the most confusing failure mode in the framework, which is the prebuilt-tree branch of the missing-transform error. Cost is one tool, and it needs no new framework concept. **A config file is not applicable**: `bunfig.toml` already exists and a second one would be a third place to look. |
| **Automatic component discovery: no module list at all** | Decorated classes register themselves by class name; `@Service({ name })` overrides. | Explicit `@Module({ providers, controllers, imports, exports })`, each module a scope. | **No** | Registration by class name is a global flat namespace with string keys, which is what dunx's scope graph exists to replace. It also makes "which module declares this" unanswerable, and that question is what dunx's best error messages are built on. The convenience is real and the loss is the whole encapsulation model. |
| **`@Inject(Service, s => s.connection)`: transform during injection** | An expression injects a derived property rather than the component. | `provide(T, { useFactory, inject })`. | **No** | Same capability, and dunx's spelling puts it in the module where it is visible rather than at each injection site. Two consumers wanting the same derived value would write the expression twice in Asena. |
| **Documented as a docs site with concepts / packages / examples / roadmap sections** | `asena.sh`, versioned, with a per-package section and a public roadmap page. | 21 guide pages plus a published migration page and two architecture pages, generated into a site; the rest of `docs/` stays in the repo. | **Partly** | Structurally the two are close and dunx's split (guide published, decision record repo-only, gated by a prose linter) is more disciplined than anything Asena does. What Asena has that dunx does not is a **per-package docs section** and a **public roadmap page**. dunx's `ROADMAP.md` is deliberately unpublished, and I would keep it that way; the per-package section is worth copying, since `@dunx/infra`'s eight subpaths are currently split across five guide pages. |
| **Microservices, brokers, OpenTelemetry as official packages** | Shipped, broker-agnostic. | None. `docs/research/brokers.md` verdict is "neither now", pending an external issue. | **No** | dunx's roadmap explicitly freezes peripheral packages until someone who is not the owner files an issue, and the `@dunx/queue-dashboard` round trip is the argument. Asena is spending surface area dunx has decided not to spend. |
| **Testing utilities: `mockComponent`, `createTestApp`, `createWebTest`** | Shipped. | `createTestApp` / `createTestServer`, overrides replaced in place, real server on port 0. | **No** | dunx already has the two that matter and its override semantics (replace in place, never rebuild, error on a token nothing binds) are more precisely specified. `mockComponent` is `provide(T, { useValue })`. |

### What dunx should steal, ranked by value for effort

1. **A `dunx build` command** wrapping `Bun.build({ plugins: [depsPlugin] })`.
   Highest value for lowest effort. It needs no new framework concept, and it removes
   the failure mode that costs the most time: someone deploys a compiled tree, DI
   stops working, and the fix is at build time rather than in the preload they keep
   re-checking. The error message already knows how to explain this; a command would
   mean fewer people meet it.
2. **Multi-binding, as `tokenSet<T>()` resolving to `readonly T[]`.** The one genuinely
   missing capability. dunx works around its absence three times already (health
   indicators, error filters, seeders) by passing arrays through options, which puts
   construction outside the container and loses the lifecycle hooks. Bounded work in
   `Injector` and the scope graph, no transform changes, no metadata.
3. **Rooms vocabulary over `PubSub`, and schema inheritance from `@Controller`.** Two
   small ergonomic wins with migration value: "rooms" is what a socket.io migrant
   searches for, and repeating a `params` schema on every route of a controller is the
   most obvious repetition left in the route API.

Also worth taking, and not framework work: a **per-package docs section**, because
`@dunx/infra`'s eight subpaths are documented across five guide pages with no page
that lists them.

### The one I reject most confidently

**The pluggable HTTP adapter.** It is the most architecturally appealing idea here and
it is the one that would cost dunx the most. An adapter seam forces a framework-owned
`Context` type between the handler and the runtime, and that is precisely the layer
dunx does not have. Everything the README leads with depends on its absence: the
"gap to raw `Bun.serve` is dunx overhead and nothing else" framing is only measurable
because there is one path; `Bun.serve({ routes })` does the matching, so there is no
JavaScript router to keep fast; and a handler returns a plain object because there is
no `Context` to wrap it in.

The evidence is in Asena's own repo. Its fast adapter, `ergenecore`, is the one that
**drops Hono and calls `Bun.serve` directly**, and the docs note that the two adapters
do not even agree on how a middleware returns a response, so business logic is not in
fact portable across them. The abstraction charges a real cost and delivers less
portability than it advertises.

Second-most confidently rejected: **automatic component discovery**. Registering
components by class name into one flat namespace is what dunx's per-module scopes and
`exports` exist to replace, and it would make "which module declares this token"
unanswerable. That question is what dunx's best error messages are built out of, and
they are the framework's most concrete advantage over Nest.
