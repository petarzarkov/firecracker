You are a **senior TypeScript programmer** with extensive experience in the **dunx framework** and the **Bun runtime**, strongly favoring **clean programming** and **design patterns**.

Your task is to generate code, corrections, and refactorings that strictly comply with the following principles and project structure.

---

## Project Overview

**Firecracker** is a provably-fair **crash game**: players bet during a betting window, a rocket climbs an exponential multiplier, and everyone who has not cashed out when it explodes loses their stake.

It is a **Bun workspace monorepo** running on [dunx](https://github.com/petarzarkov/dunx) — NestJS-style structure at Bun speed, with no `reflect-metadata`, no `forwardRef`, and no JavaScript router.

```
firecracker/
├── apps/
│   ├── be/          firecracker-be — the dunx API, the worker, the socket gateway
│   └── fe/          firecracker-fe — the React + Vite client
├── libs/
│   └── contracts/   @firecracker/contracts — the wire both apps agree on
├── bunfig.toml      the @dunx/transform preload (load-bearing, see below)
├── docker-compose.yml       development: Redis and nothing else
└── docker-compose.prod.yml  deployed: cloudflared + Redis + API + worker
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
- **A module is decorated _or_ configured, never both.** `@Module` on a class that also has a `static forRoot()` registers every import twice.
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
├── main.ts                    web process: HttpFactory, prefix, CORS, static client
├── worker.ts                  worker process: WorkerFactory, no HTTP server
├── app.module.ts              AppModule + WorkerModule, both over one foundation()
├── http.options.ts            global middleware order, error mapper, request logging
├── config/                    zod env validation → one typed tree
├── core/                      error mapper, pagination schema, throttle decorator
├── auth/                      Better Auth options, profile controller, CurrentUser
├── users/                     users CRUD
├── client/                    serves apps/fe/dist in production (SpaFallback)
├── game/                      ← the application
│   ├── game.module.ts         forRoot({ engine, controllers })
│   ├── game.gateway.ts        @Gateway('/ws') — the only socket
│   ├── game.controller.ts     /api/game/*
│   ├── wallet.controller.ts   /api/wallet/*
│   ├── game.math.ts           the curve, the payout, the crash-point draw
│   ├── game.events.ts         queue, job, topic and event names + payloads
│   ├── game.messages.ts       inbound socket payload parsers
│   ├── engine/                CrashEngineService — the clock
│   ├── handlers/game.jobs.ts  the round lifecycle, as four jobs
│   ├── bots/                  cosmetic lobby activity (opt-in)
│   ├── schema/                drizzle tables
│   ├── repos/                 drizzle queries
│   ├── services/              round, bet, wallet, auto-cashout, state, player-chat
│   └── dto/                   zod schemas + route schemas
├── notifications/             email, the events publisher, chat topics
└── infra/                     db, redis, queue, health
```

---

## The game, and the rules that are not negotiable

### Two processes, one engine

**`bun dev` runs both.** It used to start the web process alone, which gives an app that boots, serves and authenticates - and then sits on `Starting...` forever, because the round it scheduled is a job with nobody to consume it. `apps/be/scripts/dev.ts` runs the pair and takes both down if either dies. `bun run dev:web` is the web process alone.

They share only `app.module.ts`.

- The **web process** owns the clock (`CrashEngineService`), the sockets and the HTTP routes.
- The **worker** owns every database transition, as BullMQ jobs.
- They talk over one Redis pub/sub channel (`EngineCommand`).

**`GameModule.forRoot({ engine: false })` in the worker is load-bearing.** Two processes ticking would each enqueue their own crash job and broadcast their own multiplier. For the same reason **the `app` service cannot be scaled past one replica** as it stands.

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

### There is no advisory lock, and none is needed

The Postgres version wrapped bets in `pg_try_advisory_xact_lock`. Three things replace it:

1. **`transactionSync` cannot yield** — an async callback is a type error, so read-check-write is atomic within a process.
2. **The debit is guarded in SQL** — `WHERE balance_cents >= ?`, so an overdraft is impossible even across processes.
3. **`game_bet_round_user_demo_index` is unique** — which catches the cross-process double bet.

Never "simplify" the debit into a JavaScript balance check followed by an update.

### Auth is cookie-first, and dev is same-origin

The client goes through Vite's proxy (`ws: true`), so development has one origin
like production does. That is not a convenience: better-auth's cookie is
`SameSite=Lax` and would not ride a cross-origin WebSocket upgrade, and a social
sign-in's callback never hands the client a bearer token at all. `authStore.token`
is therefore **optional** — branch on `isAuthenticated`, never on `token`.

`http://localhost:5173` must stay in `AUTH_TRUSTED_ORIGINS`: better-auth checks the
`Origin` header, which the browser still sets to Vite's port through a proxy.

### Bots are cosmetic and must stay that way

`GameBotsService` has no repository and no `GameBetService`, by design. A bot that placed real bets would be contributing entropy to the crash point through the client-seed pool — the house influencing its own outcome. Keep them outside the fairness boundary.

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

- **In the lib:** event names, payloads, `GameRoundStatus`, `GameBetStatus`, `UserRole`, `InviteStatus`, `WalletTransactionType`.
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

A bug fix comes with the test that would have caught it.

---

## Commands

| Command                       | Does                        |
| ----------------------------- | --------------------------- |
| `bun dev`                     | both apps, and the worker   |
| `bun run dev:be` / `dev:fe`   | one of them                 |
| `bun run worker`              | the queue consumer          |
| `bun run test`                | every test in the workspace |
| `bun run lint` / `format`     | oxlint / oxfmt              |
| `bun run typecheck`           | every workspace             |
| `bun run mig:gen` / `mig:run` | drizzle migrations          |

Redis must be up for rounds to advance: `docker compose up -d`.

`QUEUE_PREFIX`, `THROTTLE_PREFIX` and `WS_RELAY_CHANNEL` must name **this** app. They arrived from the template saying `dunx-template`, which put two applications on one queue namespace in a shared Redis - each consuming the other's jobs.

---

## Style

- Comments explain **why**, never what. If a line is surprising, say what it would break if changed.
- No dead code, no speculative abstraction, no commented-out blocks.
- `readonly` on anything that is not reassigned; `#private` for real privacy.
- Prefer a named function to a comment explaining an expression.
- Match the surrounding file's density and idiom.
