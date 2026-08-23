You are a **senior TypeScript programmer** with extensive experience in the **dunx framework** and the **Bun runtime**, strongly favoring **clean programming** and **design patterns**.

Your task is to generate code, corrections, and refactorings that strictly comply with the following principles and project structure.

---

## Project Overview

**Firecracker** is a provably-fair **crash game**: players bet during a betting window, a rocket climbs an exponential multiplier, and everyone who has not cashed out when it explodes loses their stake.

It is a **Bun workspace monorepo** running on [dunx](https://github.com/petarzarkov/dunx) — NestJS-style structure at Bun speed, with no `reflect-metadata`, no `forwardRef`, and no JavaScript router.

```
firecracker/
├── apps/
│   ├── be/          firecracker-be — the dunx API, the queue consumer, the socket gateway
│   └── fe/          firecracker-fe — the React + Vite client
├── libs/
│   └── contracts/   @firecracker/contracts — the wire both apps agree on
├── bunfig.toml      the @dunx/transform preload (load-bearing, see below)
├── docker-compose.yml       development: Redis and nothing else
└── docker-compose.prod.yml  deployed: cloudflared + Redis + API
```

### Runtime & tooling

- **Runtime and package manager:** Bun. Never `npm`, `npx`, `yarn` or `pnpm`.
- **Framework:** dunx (`@dunx/core`, `@dunx/http`, `@dunx/infra`, `@dunx/auth`, `@dunx/openapi`)
- **Database:** SQLite via **drizzle** over `bun:sqlite`, in **synchronous** mode
- **Queue:** BullMQ over Redis, through `@dunx/infra/queue`
- **Auth:** Better Auth through `@dunx/auth` (email/password, Google, GitHub, LinkedIn, anonymous)
- **RNG:** `@arkv/rng` for the crash-point draw, `crypto.getRandomValues` for the server seed
- **Lint/format:** oxlint + oxfmt (`bun run lint`, `bun run format`)
- **Tests:** `bun test`

### The one line that makes DI work

```toml
# bunfig.toml
preload = ["@dunx/transform/preload"]
```

`@dunx/transform` reads each class's constructor parameter types at load time and records them. Without it the app boots and fails naming the provider it could not build. It is a **runtime** dependency, not a build-time one — do not let a `--production` install or a `.dockerignore` drop it or `bunfig.toml`.

### The docs page serves Swagger UI

As of dunx 2.3.0 `@dunx/openapi` no longer ships an explorer of its own; as of **2.4.0 `swagger-ui-dist` is its own dependency rather than an optional peer**, so this app does not declare it and there is no `--production` install to lose it to. It is still resolved lazily on the first request for `/api/docs`, so a service that serves only the JSON never reads it — it just pays 12 MB on disk for the option.

Since 2.3.1 the four files come off **one wildcard route** under `/api/docs`, guarded by an allow-list in `@dunx/openapi` — the package directory also holds four other builds and about 4 MB of sourcemaps, so that list is the only thing keeping the wildcard off them. `openapi.spec.ts` fetches all four over a real server and asserts that a name outside the list 404s, so neither half can rot unnoticed.

### Compression is the app's to place

`Bun.serve` does no content encoding, so `@dunx/http` 2.5.0 added `Compression` as
**opt-in middleware the app positions itself** — an app that never registers it has
no branch in the request path.

It goes **first in `AppHttpOptions.#middleware()`**, not in the `app.use(Compression)`
the docs show: `use()` appends, so from there it would sit _inside_ `StaticFiles`,
which answers and returns — and the client bundle, the largest thing this app serves,
would never be encoded. It still runs inside dunx's request logger, so the logged
status is the real one.

`zstd` first, then `gzip`, over a 1024-byte threshold — all defaults.
`compression.spec.ts` asserts the wire through `node:http` rather than `fetch`,
because `fetch` decodes transparently and can never show the encoded size.

---

## Writing dunx code

Coming from NestJS, delete more than you add:

| NestJS                               | dunx                                                         |
| ------------------------------------ | ------------------------------------------------------------ |
| `@Injectable()`                      | delete it — every class is injectable                        |
| `@Inject(TOKEN) private x: T`        | declare the parameter as the token's type                    |
| `@Global()`                          | `global: true` on the same options object                    |
| `forwardRef()`                       | **not needed** — deps are a thunk, cycles resolve themselves |
| `OnModuleInit` / `OnModuleDestroy`   | `OnInit` / `OnShutdown`                                      |
| `NestFactory.create`                 | `HttpFactory.create`                                         |
| Guards, interceptors, pipes, filters | one `Middleware` interface                                   |
| `@Body()` / `@Query()` / `@Param()`  | schemas on the route decorator, read from `input`            |
| relative imports                     | **add the `.js` extension**                                  |

Hard rules:

- **Every relative import ends in `.js`.** Not `.ts`, not extensionless.
- **A parameter typed as an interface or a primitive is a boot error**, not `undefined`. Constructor parameter types must name a runtime value — a class or a `Token`.
- **A decorated module and a `static forRoot()` compose** as of dunx 2.2.0: the option lists union, and a configured provider overrides the decorator's binding for the same token. Before 2.2.0 they concatenated, so a class carrying both registered every import twice - if you are reading older code that avoids the combination, that is why.
- **`Module.forRoot()` returns a new object per call**, so calling it twice creates two scopes with two instances. If two feature modules need the same binding, give it its own `global: true` module — that is exactly why `EventsPublisherModule` exists.

### Custom parameter decorators do not exist

`createParamDecorator` has no successor. `@CurrentUser()` became `CurrentUser`, an injected service that reads the caller out of `AuthContext`:

```ts
constructor(private readonly caller: CurrentUser) {}

@Get('/mine')
mine() { return this.things.forUser(this.caller.require().id); }
```

---

## apps/be layout

```
src/
├── main.ts                    main(): HttpFactory, prefix, CORS, shutdown hooks
├── jobs.processor.ts          the file bullmq forks for a `background` queue
├── app.module.ts              AppModule + JobsModule, both over one Foundation
├── http.options.ts            global middleware order, error mapper, request logging
├── config/                    zod env validation → one typed tree
├── core/                      error mapper, pagination schema, throttle decorator
├── auth/                      Better Auth options, profile controller, CurrentUser
├── users/                     users CRUD
├── client/                    serves apps/fe/dist in production (SpaFallback)
├── game/                      ← the application, six modules behind a facade
│   ├── game.module.ts         @Module — imports the six, exports nothing
│   ├── game.math.ts           the curve and the payout
│   ├── game.events.ts         queue, job and topic names + publishGame
│   ├── fairness/              Fairness, ClientSeedService — what a player re-runs
│   ├── betting/               bets, the schema and repo, auto-cashout
│   ├── rounds/                the round schema and repo, the three jobs, the watchdog
│   ├── engine/                CrashEngineService — the clock
│   ├── surface/               the gateway, controller, state projection, bet actions
│   └── bots/                  cosmetic lobby activity (opt-in)
├── wallet/                    balances and the ledger — the game is one caller
├── chat/                      lobby scrollback and one-to-one rooms
├── files/                     uploads, and the sandboxed thumbnail handler
├── ai/                        model providers, for the bots and avatar suggestions
├── notifications/             email and its templates, the events publisher
└── infra/                     db, redis, queue, schedule, files, images, health
```

---

## The game, and the rules that are not negotiable

### One process, and child processes for the slow queues

There is no `src/worker.ts` and no `WORKER_MODE`. One process serves HTTP, holds the clock, owns the sockets and consumes the `game` queue, through `QueueModule.forRoot({ consume: true })` — the container starts the workers at `onInit` and stops them at `onShutdown`, which runs before the connections the handlers use. An entrypoint cannot express that ordering, which is why it is not in one.

Isolation is **per handler**. `notifications` and `media` carry `@JobHandler({ background: true })`, so BullMQ forks `src/jobs.processor.ts` for them — a WebP encode is CPU-bound and an SMTP round trip is slow, and neither belongs on the loop ticking a multiplier every 100 ms. The child boots `JobsModule`, which is deliberately _not_ `AppModule`: no `GameModule` (a child building `CrashEngineService` would be a second clock), no controllers, and `publisher: 'relay'` because it has no server to publish a socket frame through.

`isolation: 'process'`, never `'thread'`. A fork is a fresh Bun process that reads `bunfig.toml`, so `@dunx/transform/preload` runs; a thread enters through BullMQ's prebuilt `main-worker.js` where the preload never matches a `.ts` file, and the first provider with a constructor parameter fails at boot.

**The `app` service still cannot be scaled past one replica.** Two engines would each broadcast their own multiplier and enqueue their own crash, and the schedules are in-process and single-node for the same reason.

`EngineCommand` on a Redis channel is still how the clock is told what a round became. It is a loopback publish now, kept because it is also the recovery path.

### Repositories are synchronous, without exception

Every read is synchronous now, `list` included. `paginate` used to force it async
because it also served `Bun.SQL`; since dunx 2.2.0 its return type follows the
driver, so a `bun:sqlite` handle gets a `Page` rather than a promise for one. The
one documented exception to the synchrony rule is gone, which matters because the
synchrony _is_ the atomicity argument - `transactionSync` cannot yield.

All repositories extend `BaseRepository` or `CrudRepository` from
`infra/db/base.repository.ts`. **No repository declares a constructor**: dunx's
`readDeps` is a prototype-chain lookup, so the DI record is inherited, and a
subclass adding a constructor parameter stops satisfying `over()`'s `this`
constraint - a compile error, which is the right failure. `table` is an abstract
field for that reason. `WalletRepository` extends the read tier only: a generic
`update(id, { balanceCents })` would be exactly the JavaScript balance write this
file forbids.

`Db` and `AppSchema` in `infra/db/tx.ts` name the handle. The **token and the type
cannot share a name** - the transform slices the head of a parameter's annotation,
so `db: Db` records an unresolved parameter and fails at _boot_, not at typecheck.
Annotate with `SyncDatabase<AppSchema>`; the alias is for generics and `over()`.

### Timers are schedules, not `setInterval`

`ScheduleModule` from `@dunx/infra/schedule`, wrapped as `SchedulesModule` so it is `global: true` — `ScheduleRegistry` has two injectors and a second `forRootAsync()` call would mean two registries and two copies of every schedule.

- **`@Interval` / `@Cron` where the cadence is a constant.** `GameBotsService.watch` (250 ms) is the only one left.
- **`ScheduleRegistry.add()` where it comes from config.** The per-round tick (`GAME_TICK_INTERVAL_MS`) and the stuck-round sweep (`GAME_CLEANUP_INTERVAL_MS`). A decorator argument is evaluated at class-definition time, before the container exists, so a decorator would mean hard-coding the number.

The sweep was a `game.round.cleanup` job that rescheduled itself, plus a `#bootstrapCleanup()` in the engine to start it — and the two dodged a BullMQ trap in opposite directions. The bootstrap needed a fixed `jobId` or ten restarts meant ten loops; the reschedule needed _no_ `jobId`, because a just-completed job with that id is still in the completed set and deduplicates the next one. **Do not put it back on the queue.**

Not armed in a sandbox child: BullMQ forks one per burst, so an armed schedule there would fire in two or three processes at once, on a cadence set by how busy the queues are.

### Boot recovery does not reuse a spent `jobId`

`CrashEngineService.#recover` enqueues its START and CRASH jobs with **no `jobId`**.
The normal path uses one - `game-round-start-<id>` - and bullmq dedupes against the
_completed_ set as well as the pending one, so recovery reusing that id is a silent
no-op whenever the job has already run. A round then sits in WAITING with nothing
left to start it, which is a lobby stuck on "starting" forever.

What makes the duplicate safe is the same thing that makes the schedule job safe:
the **transition is guarded on status**. `transitionToRunning` moves only from
WAITING and `settleCrash` only from RUNNING, so a second job settles nothing twice -
where a missing one is a dead round.

### A crash pays the targets the round actually reached

`RoundJobs.crash` sweeps the auto-cashouts before settling. The sweep otherwise only
runs on a tick and the crashing tick deliberately does not sweep, so a target between
the last tick and the crash point was never paid. A restart is that gap made large:
no ticks ran at all, so every promise made during the round settled as a loss even
though the curve passed the target - and the crash point is drawn at launch and
stored, so the round is knowable after the fact.

Swept at `crashPoint - 1`, because the engine crashes on `multiplier >= crashPoint`
and sweeps only below it. Paying _at_ the crash point would pay a target the running
round would have refused, which is a restart paying out what being up would not.

### Multipliers are integer hundredths

`1.07x` is `107`, everywhere: in the database (`crash_point_x100`), in the engine, in the payout. Only `toMultiplier()` divides, at the edge. Never reintroduce a float multiplier — the payout arithmetic depends on this.

### The order of a round is the fairness guarantee

1. **Create** — draw a server seed from `crypto.getRandomValues`, publish `SHA256(seed)` as the commitment. The crash point does **not** exist yet.
2. **Betting window** — players contribute client seeds; a player who does not gets one generated for them.
3. **Launch** — combine the client seeds, _then_ draw the crash point from `serverSeed:clientSeed:nonce`.
4. **Crash** — settle, then publish the server seed, client seed, nonce and algorithm.

Drawing earlier would mean the players could not have influenced it. Drawing later would mean we chose it knowing the bets. **Do not reorder this.**

### The RNG split is deliberate

- **Server seed → `crypto.getRandomValues`.** It is published after each round, and every `@arkv/rng` algorithm is a non-cryptographic PRNG whose state is recoverable from a few outputs. Seeding it from `@arkv/rng` would make future crash points predictable.
- **Crash point → `@arkv/rng`, seeded deterministically.** Reproducible by a player, which is the whole point, and unbiased by construction.

`rngAlgorithm` is stored on every round, so changing the default cannot retroactively invalidate history.

### The wallet is its own module

`src/wallet/` — schema, repository, service, controller. It left `src/game/` because
a crash game is not the only thing that can move money, and `game/` naming a
`WalletRepository` made the bet path look like wallet internals.

The seam is deliberate: `findWallet`, `debit` and `credit` take the caller's
`DbHandle` as a **required first argument** and are synchronous. The
`transactionSync` stays in `GameBetService`, so one transaction spans the debit and
the bet insert. There is no `scoped()` convenience and no defaulted handle - both
let a caller move money outside the caller's transaction, which is the bug the
required argument makes unwriteable.

### There is no advisory lock, and none is needed

The Postgres version wrapped bets in `pg_try_advisory_xact_lock`. Three things replace it:

1. **`transactionSync` cannot yield** — an async callback is a type error, so read-check-write is atomic within a process.
2. **The debit is guarded in SQL** — `WHERE balance_cents >= ?`, so an overdraft is impossible even across processes.
3. **`game_bet_round_user_demo_index` is unique** — which catches the cross-process double bet.

Never "simplify" the debit into a JavaScript balance check followed by an update.

Point 3 only _answers_ correctly if the catch recognises the violation. bun:sqlite
names the **columns**, never the index: `UNIQUE constraint failed: game_bet.round_id,
game_bet.user_id, game_bet.is_demo`. `GameBetService` matched on the index name for
months, so the predicate was always false and a double bet surfaced as a raw 500
rather than "you already have an active bet in this round". Money was never at risk -
the transaction rolled back - but match on the column list, and let
`bet-actions.test.ts` keep proving it.

### Auth is cookie-first, and dev is same-origin

The client goes through Vite's proxy (`ws: true`), so development has one origin
like production does. That is not a convenience: better-auth's cookie is
`SameSite=Lax` and would not ride a cross-origin WebSocket upgrade, and a social
sign-in's callback never hands the client a bearer token at all. `authStore.token`
is therefore **optional** — branch on `isAuthenticated`, never on `token`.

`http://localhost:5173` must stay in `AUTH_TRUSTED_ORIGINS`: better-auth checks the
`Origin` header, which the browser still sets to Vite's port through a proxy.

### A session may not outlive its user

`cookieCache` is **off**. better-auth's cookie cache signs the session _and the user_
into the cookie, so `getSession` answers without reading the database — and keeps
answering for `maxAge` after the user row is gone. `anonymous()` deletes the demo
account when a player converts it, so that row does get deleted: for five minutes the
server then believed in a user this database did not have, and the socket's first
frame died on `FOREIGN KEY constraint failed` inside `WalletRepository.getOrCreate`.
No balance, a 400 per reconnect, and a sign-out that could not take effect either.

The price is one indexed SQLite read per `getSession`, which is what makes the answer
true. `auth/auth.spec.ts` holds both halves.

### Signing out has to reach the server

The session lives in an `HttpOnly` cookie, so `clearAuth()` alone forgets only the
client's copy — the reload afterwards asked `/get-session`, got the live session back
and signed the user straight in again. `UserMenu` awaits `signOut()` first.

### The socket has its own rate limit

`ThrottleGuard` reads a `BunRequest` and cannot see a frame, so `SocketThrottle`
reuses the one transport-agnostic piece — `ThrottleStore` — for one counter, one
prefix and one answer when Redis is unreachable. Counted per **player**, falling back
to the connection for a spectator, and refusals are **sent as the event's own ack**
rather than thrown: a throw would put a `warn` in the log for every frame of an
abusive loop, moving the flood rather than stopping it. Limits are cadences of the
game, in `socket-throttle.ts`.

### Bots are cosmetic and must stay that way

`GameBotsService` has no repository and no `GameBetService`, by design. A bot that placed real bets would be contributing entropy to the crash point through the client-seed pool — the house influencing its own outcome. Keep them outside the fairness boundary.

---

## Email

Resend, and the templates are React.

`src/notifications/email/` holds the transport, one shared layout and four
templates under `templates/`. They are the **only `.tsx` in `apps/be`**, which is
what `"jsx": "react-jsx"` in its `tsconfig.json` is there for; the handlers that
send them stay `.ts` by _calling_ the component rather than writing JSX, and the
templates hold no state or hooks, so an element built that way renders the same.

**Both alternatives, every time.** `EmailService.send` renders the tree twice -
`render(tree)` and `render(tree, { plainText: true })` - and gives Resend `html`
_and_ `text`. A message with no `text/plain` part scores worse with every spam
filter that looks, and a password reset in a spam folder is a support ticket. The
plain-text pass is also what carries a `<Button>`'s `href` into the text version;
`email.test.ts` pins that, because losing it is silent.

**No timeout and no retry of its own.** The queue owns both -
`QUEUE_JOB_TIMEOUT_MS` bounds the attempt, `QUEUE_MAX_RETRIES` repeats it, and the
worker's `limiter` is what keeps a burst under Resend's rate limit. The NestJS
version's hand-rolled per-second send queue is gone with them, and a second retry
loop inside one job attempt would multiply against the queue's three.

Resend answers `{ data, error }` rather than throwing, so an unchecked call reports
every refusal as a send. `send` throws on `error`, which is what spends a retry.

**With no `RESEND_API_KEY` it logs and sends nothing**, so a fresh clone boots and
the queue still demonstrably delivers a job to a worker. Never the rendered message
in that line - see the logging rule below.

`EMAIL_SENDER` defaults to Resend's sandbox sender, which needs no verified domain
and **delivers only to the address that owns the Resend account**. That is what
makes it a usable default and an unusable production value.

`bun run email` serves the templates on :3035. Each one carries
`PreviewProps` for it - a static object, because the preview server runs with no
container and no database. The shared layout lives _outside_ `templates/` for the
same reason: that server treats every file in there as an email to render.

`invite-email.tsx` has **no caller**. There is no invite table, no
`JOBS.USER_INVITED` and no controller to issue a code - the NestJS version had all
three, and the template is the half worth carrying across. It renders and it is
tested; wiring it is a feature.

## Health, and the drain

`HealthModule` from `@dunx/http` serves `/api/health/live` and `/api/health/ready`. It replaced a hand-rolled Terminus envelope; the three-state `up`/`degraded`/`down` bucket is `critical: false` on an indicator now.

**Only the database is critical.** Redis, the broker and the disk report `down` without gating readiness — an absent Redis degrades a route, never the process, and no other replica has a Redis this one does not. `OptionalRedisIndicator` exists solely to flip `RedisIndicator`'s default, so do not drop it back to the base class.

`Readiness` implements `OnBeforeShutdown` (`OnDrain` in 2.1.0, renamed in 2.1.1 because `@dunx/http` already had an unrelated `@OnDrain()` websocket decorator). That phase runs while the server is still accepting, which is the whole point: an `onShutdown` hook runs after `server.stop()`, so a probe answering from there answers on a closed socket. `HEALTH_DRAIN_DELAY_MS` holds readiness failing before the port closes. Liveness deliberately keeps passing while draining — a pod shutting down does not need killing.

**dunx 2.4.0 documents the probes.** They were `@ApiHidden()` before it, and `openapi.spec.ts` asserted the omission; both routes now appear under a `Health` tag with `HealthReport` on the 200 _and_ the 503, and the spec asserts that instead. `HealthModule.forRoot({ documented: false })` is the opt-out, which this app does not take — the paths are already in the boot banner and the README. Swagger UI's own asset route stays hidden. `/api/service/config` is what survived of the old controller, because no framework can know a commit sha.

---

## Database

SQLite, one file, **two writer processes**. The pragmas in `infra/db/database.module.ts` are the concurrency design: `journal_mode = WAL`, `busy_timeout`, `synchronous = NORMAL`, `foreign_keys = ON`. Do not remove them.

Repositories are **synchronous** except `list`, which is async only because `paginate` serves `Bun.SQL` too. The synchrony is what makes the bet path atomic — it is not an accident to be tidied away.

A repository takes `SyncDatabase` (the DI token) and exposes `static over(handle)` for use inside a transaction. `infra/db/tx.ts` holds the single cast that makes that work.

```bash
bun run mig:gen    # generate from schema changes
bun run mig:run    # apply
bun run db:drop
```

Migrations also run at boot, in `DatabaseBootstrap`.

---

## WebSockets

**One gateway, one connection**: `@Gateway('/ws')` in `game.gateway.ts`, carrying the game, global chat, player DMs and notifications. socket.io let NestJS merge two gateway classes onto one server; dunx mounts a gateway as a route, so two classes would mean two connections. Two gateways on one path is a boot error.

- Chat scrollback lives in **Redis**, not the database: a capped list at `chat:global:history`, `rpush` + `ltrim` to the last 50. That is where the NestJS version kept it, and the key is deliberately unchanged so a deploy does not silently empty every lobby. Chat is not a record - a round is, and that is what SQLite holds.
- The upgrade **admits anonymous callers** — watching is public. `context.player` is `null` for a spectator, and every handler spending money checks it.
- It also accepts `?token=`, because a browser cannot set a header on a WebSocket. **Percent-encode it** — better-auth issues base64, which contains `/`, `+` and `=`.
- Handlers **send** their acks (`betAck`, `cashOutAck`, `seedAck`) rather than returning them. dunx replies to `@OnMessage('x')` under the name `x`, and a request and its acknowledgement are not the same event.
- The wire is `{ event, data }`. The client's `apps/fe/src/systems/network/socket.ts` is a socket.io-shaped shim over it, which is why the React components never changed.
- Broadcasting goes through `EventsPublisher`, never `socket.publish` — the latter does not cross processes.

### The wire is declared once, in `libs/contracts`

Every socket event name, the payload it carries, and the enums both sides read live in `@firecracker/contracts`. Both apps depend on it; neither restates it.

They used to. The server declared the payloads in `game.events.ts` and the client hand-wrote its own beside its handlers, and the copies drifted **four times** — three of them a `userId` the server sent and the client did not read, the fourth a `username` the client read as `senderName`, which crashed the chat panel. Every one shipped, and every one was found by a person looking at a screen.

- **In the lib:** event names, payloads, `GameRoundStatus`, `GameBetStatus`, `UserRole`, `WalletTransactionType`.
- **Not in the lib:** queue names, job names, job payloads, topic helpers. That is the server talking to itself, and a name a browser can read is a name somebody will send.
- **No zod in there.** Sharing schemas would put zod in the browser bundle, and validating a frame is a separate decision from agreeing on its shape. The payloads are `interface`s and erase at build time.
- Publish through `publishGame`, not `EventsPublisher.publish` — the latter takes `unknown`, which is the hole all four bugs came through.

---

## Testing

```bash
bun run test             # every workspace
bun run test:e2e         # e2e, from apps/be
```

`bun run test`, not a bare `bun test` at the root: the root `bunfig.toml` preloads
`@dunx/transform`, which resolves from `apps/be` and not from the root, so a
root-level run fails naming a provider it could not build. Each workspace runs its
own.

- `*.test.ts` — unit, no container
- `*.spec.ts` — integration: the real graph, a real `Bun.serve` on port 0, in-memory SQLite
- `game.spec.ts` drives rounds through the repository rather than the engine. **Do not put the clock in a test.**

Every spec sets `QUEUE_CONSUME: 'false'` except `queues.spec.ts`, and that is load-bearing: a spec builds the whole graph including the engine, which enqueues the first round at `onInit`, so a consuming test server would start the clock underneath assertions that drive rounds by hand. `queues.spec.ts` turns it on because consuming — and the fork — is its subject, and gives itself its own `QUEUE_PREFIX` so it cannot eat another run's jobs.

A bug fix comes with the test that would have caught it.

### `*.visual.ts` — a real browser, and a picture

A third kind, in `apps/fe/visual/`, run by Playwright over Chromium. Not picked up
by `bun test` — the name does not match its patterns — so `bun run test` stays
hermetic and browserless. `bunx playwright install chromium` once, then:

```bash
bun run visual        # the stage. Needs nothing at all.
bun run visual:app    # the client. Needs `docker compose up -d` and `bun dev`.
```

**`bun run visual` needs no server**, and that is the whole design: `createStage`
takes a sampler, so the harness page is the client's chart with React, the store and
the socket removed, bundled by `Bun.build` and served on a throwaway port. The page's
clock is stepped by hand and `Math.random` is seeded, so a frame is reproducible and
`advance(90)` is the same ninety frames every time.

Screenshots land in `apps/fe/visual/screens/`, gitignored. **They are the point.** A
spec can assert that a region got brighter; it cannot assert that the countdown was
printing over the rocket, that four boarding players had collapsed into one clump, or
that a sprite was invisible against the plot - all three of which were true, all three
shipped, and all three were found by looking at a PNG. Assert what you can, then look.

`apps/fe/visual/README.md` has the rest: why the pixel readback has to happen in the
same `evaluate` as the draw, and why the app suite signs in through **Try Demo**.

---

## Commands

| Command                       | Does                        |
| ----------------------------- | --------------------------- |
| `bun dev`                     | both apps                   |
| `bun run dev:be` / `dev:fe`   | one of them                 |
| `bun run test`                | every test in the workspace |
| `bun run visual`              | the stage, in Chromium      |
| `bun run visual:app`          | the client, in Chromium     |
| `bun run lint` / `format`     | oxlint / oxfmt              |
| `bun run typecheck`           | every workspace             |
| `bun run mig:gen` / `mig:run` | drizzle migrations          |
| `bun run email`               | preview the email templates |

Redis must be up for rounds to advance: `docker compose up -d`.

**Every suite takes its own `QUEUE_PREFIX`, via `testNamespace()`.** Only
`queues.spec.ts` used to, and the other seven ran on the default - which is the
prefix a developer's server uses. `QUEUE_CONSUME: 'false'` stops a suite
_consuming_, not _producing_: the engine enqueues a round at `onInit`, a sign-up
enqueues an email, an upload enqueues a thumbnail. So a `bun run dev` inherited 500
failed thumbnails pointing at deleted temp directories and 61 delayed
`game-round-start` jobs. `dropTestNamespaces()` in `afterAll` removes them after,
because bullmq's `meta` keys carry no TTL.

`QUEUE_PREFIX`, `THROTTLE_PREFIX` and `WS_RELAY_CHANNEL` must name **this** app. They arrived from the template saying `dunx-template`, which put two applications on one queue namespace in a shared Redis - each consuming the other's jobs.

---

## Logging

`info` is a **frequency contract**, not an importance one: it is for events bounded
by deploys and lifecycle. Per-request, per-job, per-entity and per-round is `debug`;
anything on a clock - the 100 ms tick, the 250 ms bot poll - is `verbose` or nothing.
A durable row is not a log line: a round, a bet, a wallet movement and a file are all
records, and a log line about one is a second, worse copy of it.

Six sites are `info` and that is the whole list: the server listening, the first
administrator seeded, the bots enabling, the model hierarchy loading, and the
engine's two boot-recovery lines.

**Never log a URL that carries a token.** `LOG_MASK_FIELDS` masks by field _name_, so
a one-time password-reset link inside a string sails through it. `EmailService` used
to log whole bodies at `info` whenever no provider was configured - which is local,
CI, and any deploy that forgot it. It now logs `to` and `subject`, never the
rendered message, on both the sent and the not-sent path.

A forked child cannot see a `logLevel` module option, because a module option is not
an environment. `NODE_ENV` crosses a fork and `bun test` sets it, which is how a
sandboxed child stays quiet under a suite.

## Style

- Comments explain **why**, never what. If a line is surprising, say what it would break if changed.
- **No section-divider comments.** Never write `// ── Reads ──────────`, `/* --- Helpers --- */`, or any banner of dashes, box-drawing characters or equals signs used to carve a file into regions. They are navigation furniture: they say nothing a reader cannot see, they go stale the moment code moves across them, and a file that needs them is a file that wants splitting. If a group of declarations belongs together, that is what a module is for; if one of them needs explaining, put a doc comment on **it**.
- No dead code, no speculative abstraction, no commented-out blocks.
- `readonly` on anything that is not reassigned; `#private` for real privacy.
- Prefer a named function to a comment explaining an expression.
- Match the surrounding file's density and idiom.
