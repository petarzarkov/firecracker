# 03 — Module hygiene

Seven sub-investigations, each with its own verdict. Everything below was read from
source; item 7 was reproduced against a real `Bun.serve` on port 0. dunx facts come
from `/home/petarzarkov/repos/dunx/packages/*/src` at 2.1.1, which is the version
`apps/be/node_modules/@dunx/*` resolves to.

The headline is item 7, because it is the one that is broken in production today:
**`SpaFallback` cannot work, and the fix is entirely in firecracker.**

---

## 1 — Static class modules

### The shape of every module in `apps/be/src`

`resolveRef` (`packages/core/src/di/module.ts:155-181`) confirms both rules CLAUDE.md
states. A `DynamicModule` whose `module` class _also_ carries `@Module` has its
`imports`/`providers`/`controllers`/`exports` **concatenated**, not overridden
(`concat`, line 149) — so decorated _and_ configured really does register twice. And
`collectModules` (line 189-215) dedupes a **bare class** by identity (`seenClasses`)
but a `DynamicModule` only by object reference (`seen`) — so `X.forRoot()` called
twice is two scopes, deliberately not deduped.

The corollary matters for the table: **a decorated class is the only shape that
dedupes.** `@Module({ global: true })` is supported (`ModuleOptions.global`, read at
`module.ts:169`), so a decorated class loses nothing a zero-argument `forRoot()` gave.

| module                  | file                                                 | shape                                                                               | varies per call?                                                | verdict                                                                                 |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `AppModule`             | `app.module.ts:106`                                  | undecorated + `forRoot(options)`                                                    | **yes** — `source`, `logLevel`, and the `CLIENT_DIST` branch    | must stay configurable: every `*.spec.ts` passes an env literal                         |
| `JobsModule`            | `app.module.ts:150`                                  | undecorated + `forRoot(options)`                                                    | **yes** — same options, `publisher: 'relay'`                    | must stay configurable                                                                  |
| `Foundation`            | `app.module.ts:39`                                   | not a module — `static for()` returning `ModuleRef[]`                               | n/a                                                             | fine; it is a list builder, not a scope                                                 |
| `AppConfigModule`       | `config/app.config.module.ts:23`                     | undecorated + `forRoot({ source? })`                                                | **yes** — suites pass a literal                                 | keep configured                                                                         |
| `DatabaseModule`        | `infra/db/database.module.ts:92`                     | undecorated + `forRoot()` **zero args**                                             | **no**                                                          | should be `@Module({ global: true, … })`. _Workstream 04 owns this file_ — verdict only |
| `RedisCacheModule`      | `infra/redis/redis.module.ts:24`                     | undecorated + `forRoot()` **zero args**                                             | **no**                                                          | → decorated `@Module({ global: true })`                                                 |
| `StorageModule`         | `infra/files/storage.module.ts:28`                   | undecorated + `forRoot()` **zero args**                                             | **no**                                                          | → decorated, _if_ item 2 keeps `files`                                                  |
| `ImagesConfigModule`    | `infra/images/images.module.ts:15`                   | undecorated + `forRoot()` **zero args**                                             | **no**                                                          | → decorated, _if_ item 2 keeps `files`                                                  |
| `ServiceModule`         | `infra/health/health.module.ts:38`                   | undecorated + `forRoot()` **zero args**                                             | **no**                                                          | → decorated                                                                             |
| `NotificationsModule`   | `notifications/notifications.module.ts:20`           | undecorated + `forRoot()` **zero args**                                             | **no**                                                          | → decorated                                                                             |
| `QueuesModule`          | `infra/queue/queue.module.ts:33`                     | undecorated + `forRoot({ controllers? })`                                           | **yes** — `JobsModule` passes `false`                           | must stay configurable                                                                  |
| `FilesFeatureModule`    | `files/files.module.ts:34`                           | undecorated + `forRoot({ controllers? })`                                           | **yes** — `JobsModule` passes `false`                           | must stay configurable                                                                  |
| `AIModule`              | `ai/ai.module.ts:29`                                 | undecorated + `forRoot({ controllers? })`                                           | **yes today** — becomes **no** once item 2 drops `AIController` | → decorated `@Module({ global: true })` after item 2                                    |
| `SchedulesModule`       | `infra/schedule/schedule.module.ts:27`               | undecorated + `forRoot({ enabled? })`                                               | **yes** — `false` in a job child                                | must stay configurable (see item 6 for the dunx ask that deletes the file)              |
| `EventsPublisherModule` | `notifications/events/events-publisher.module.ts:36` | undecorated + `forRoot({ publisher })`                                              | **yes** — `socket` vs `relay`                                   | must stay configurable                                                                  |
| `ClientModule`          | `client/client.module.ts:80`                         | undecorated + `forRoot(dist)`                                                       | **yes** — the dist path, and absence is meaningful              | must stay configurable                                                                  |
| `AccountsModule`        | `auth/auth.module.ts:155`                            | **decorated `@Module`** over a file-scope `const auth = AuthModule.forRootAsync(…)` | n/a                                                             | right shape, wrong contents — see below                                                 |
| `AuditModule`           | `audit/audit.module.ts:17`                           | decorated                                                                           | n/a                                                             | **delete** (item 3)                                                                     |
| `ChatModule`            | `chat/chat.module.ts:20`                             | decorated                                                                           | n/a                                                             | correct as written                                                                      |
| `UsersModule`           | `users/users.module.ts:21`                           | decorated                                                                           | n/a                                                             | correct as written                                                                      |
| `InvitesModule`         | `invites/invites.module.ts:25`                       | decorated                                                                           | n/a                                                             | right shape, dead feature (item 2)                                                      |
| `GameModule`            | `game/game.module.ts:64`                             | decorated                                                                           | n/a                                                             | correct as written                                                                      |

**Six zero-argument factories** (`DatabaseModule`, `RedisCacheModule`, `StorageModule`,
`ImagesConfigModule`, `ServiceModule`, `NotificationsModule`) exist purely to wrap a
`DynamicModule` literal in a method that takes nothing. Each is ~8 lines of ceremony
that buys a hazard: a second call is a second scope. `AccountsModule` and `AIModule`
already show the pattern that replaces them — hoist the inner
`XModule.forRootAsync(…)` to a file-scope `const` and reference it from `@Module`,
which is legal because the `const` is initialised before the decorator runs.

The user's instinct is right on the numbers: **11 of 22 modules are undecorated
static factories, and 6 of those 11 configure nothing.**

### What is concretely weird about the auth module

`AccountsModule` (`auth/auth.module.ts`) is the one module that is _both_ things at
once without tripping the `concat` rule — the decorated class is `AccountsModule`, the
configured one is `@dunx/auth`'s `AuthModule`. That is legal. Four things are still
wrong with it:

1. **It is a root pretending to be a feature.** `const auth = AuthModule.forRootAsync(…)`
   at line 40 runs at **import time** of `auth.module.js`. Four modules import that
   file — `users.module.ts:2`, `invites.module.ts:2`, `files.module.ts:2`,
   `game.module.ts:2` — and every one of them wants only `CurrentUser`. Importing a
   32-line better-auth configuration as a side effect of wanting one 30-line service
   is the coupling the user is pointing at.
2. **It is the only one-per-process root in the app that is not `global: true`.**
   `DatabaseModule`, `RedisCacheModule`, `StorageModule`, `ImagesConfigModule`,
   `SchedulesModule`, `QueuesModule`, `AIModule` and `EventsPublisherModule` are all
   global. The doc comment at lines 130-140 argues for a decorated class _because_
   `forRoot()` returns a new object per call — correct, but that argument produces
   `@Module({ global: true })`, not four hand-threaded `imports: [AccountsModule]`
   lines. Adding `global: true` deletes all four.
3. **It carries three unrelated things that are not auth.** `ProfileController` (four
   routes across three unrelated concerns — see item 4), `AuthAdminSeeder` (a boot task
   bound only so the container constructs it, explicitly not exported, line 151), and
   `AvatarsService` — a **BetterTTV emote proxy** that injects the _AI module's_ named
   HTTP client (`auth/services/avatars.service.ts:29`) and has nothing to do with
   authentication. Its own doc comment calls the pairing "slightly odd".
4. **It imports `AuditModule` for a dead route.** Line 142 imports it, and line 37-38
   says why: `ProfileController` lists a caller's own audit trail. That route
   (`GET /api/profile/audit`) has **zero callers repo-wide** (item 3/4). The auth
   module's import graph is wider than it needs to be to serve nothing.

Target shape:

```ts
// auth/auth.module.ts — the better-auth root, and only that
@Module({
  global: true,
  imports: [auth],
  providers: [CurrentUser, AuthAdminSeeder],
  exports: [auth, CurrentUser],
})
export class AccountsModule {}

// auth/profile.module.ts — the feature
@Module({ controllers: [ProfileController], providers: [AvatarsService] })
export class ProfileModule {}
```

`AvatarsService` keeps working from `ProfileModule` because `AIModule` is `global: true`
and exports its named client (`ai/ai.module.ts:72`).

**Verdict: convert the six zero-argument factories to decorated `@Module` classes
(≈48 lines and six two-scope hazards removed), keep the seven that genuinely vary, and
split `AccountsModule` into a `global: true` better-auth root plus a `ProfileModule` —
which also deletes the four `imports: [AccountsModule]` lines and the dead
`AuditModule` import.**

---

## 2 — Unused modules

### `files` — reachable, tested, and called by nothing

`FilesFeatureModule` is in both graphs (`app.module.ts:122`, `:158`). All six routes
are live and none has a caller outside tests:

| route                             | `files/files.controller.ts` | caller               |
| --------------------------------- | --------------------------- | -------------------- |
| `GET /api/files`                  | :39                         | none (spec/e2e only) |
| `POST /api/files`                 | :59                         | none                 |
| `GET /api/files/:fileId`          | :66                         | none                 |
| `GET /api/files/:fileId/download` | :78                         | none                 |
| `GET /api/files/:fileId/link`     | :88                         | none                 |
| `DELETE /api/files/:fileId`       | :95                         | none                 |

The frontend has exactly **two** `apiFetch` call sites in the whole app —
`components/game/PlayerHistory.tsx:170` (`GET /api/game/my-bets`) and
`components/ui/AvatarPicker.tsx:42` (`GET /api/profile/avatars/trending`) — plus
better-auth's own endpoints in `systems/auth/auth-api.ts`. There is no admin UI.

`FilesService` and `ThumbnailsService` have no consumer outside the module, and
`Storage`/`Images` have no consumer outside it either — so `infra/files/storage.module.ts`
(73 lines) and `infra/images/images.module.ts` (32) exist for `files` alone, as does the
sandboxed `media` queue and `MediaJobs` (102). The `storage.module.ts` doc comment
claiming `Storage` is "read by the files feature **and by the health probe**" is stale:
`health.module.ts` injects `DbConnection`, `RedisConnection`, `JobPublisher`,
`QueueOptions` and a `DiskIndicator`, never `Storage`.

**The concrete use, and it is a real one.** The avatar story today is a `text` column
(`users/schema/user.schema.ts:image`) holding a URL, filled from a list of trending
BetterTTV emotes. `AvatarPicker.tsx` is the single live FE HTTP call in the app. Wire a
`POST /api/profile/avatar` (multipart) that calls `FilesService.upload`, enqueues the
existing `media` thumbnail job, and writes the resulting URL to `users.image`. That one
route:

- gives the `files` feature its first caller,
- justifies `StorageModule`, `ImagesConfigModule`, `MediaJobs` and the whole sandboxed
  `media` queue, which are otherwise 300+ lines serving nothing,
- exercises the `background: true` fork path that `queues.spec.ts` is the only current
  user of,
- and the lobby already has somewhere to put the result: `GameGateway` carries
  `context.player`, and the bet/cashout frames already name a player, so the avatar
  rides the wire that exists.

The alternative is deleting `files` + `infra/files` + `infra/images` + `MediaJobs` +
the `files` table (≈700 lines and a migration), which also removes the only thing that
makes the two-queue fork architecture worth having.

**Verdict: keep `files`, and wire it to avatars.** One new route in `ProfileModule`, one
FE tab in `AvatarPicker`, one `users.image` write.

### `ai` — services live, controller dead

`AIService` is used by `game/bots/game-bots.service.ts:98,189`, and `AI_HTTP_CLIENT` by
`auth/services/avatars.service.ts:29`. So the module is load-bearing. `AIController`
(43 lines, `POST /api/ai/query`, `GET /api/ai/models`) has **zero callers anywhere** —
no FE, no spec, no e2e — and its own doc comment says it is operator-only.

**Verdict: delete `ai/ai.controller.ts` and `ai/dto/ai.dto.ts` (76 lines), and with
them the `controllers` option on `AIModule` — which turns that module into a
zero-argument factory and therefore into a decorated `@Module({ global: true })` per
item 1. Keep every service.**

### `invites` — dead end to end

- `InvitesController`: `GET /api/invites` (:42, admin), `POST /api/invites` (:50, admin),
  `POST /api/invites/accept` (:61, `@Public()`). No FE caller for any of them, and
  **no invite-redemption screen exists in `apps/fe`** — so the `@Public()` accept flow
  cannot be reached by a human.
- `InvitesService` has no consumer other than its own controller.
- It costs an `@hourly` schedule (`InvitesService.expireStale`) whose entire purpose is
  to keep a listing nobody reads honest.
- 527 lines in `src`, plus `e2e/invites/invites.e2e.ts` (142), plus the `invites` table,
  plus `InviteStatus` in `@firecracker/contracts`.

There is no crash-game use that is not invented. Firecracker's onboarding is open
sign-up plus better-auth's `anonymous()` "Try Demo" path; an admin-issued email
invitation is a B2B artefact from the template.

**Verdict: delete the invites feature entirely** — `invites/` (6 files), the `invites`
export in `infra/db/schema.ts:7`, `InvitesModule` in `app.module.ts:14,125`,
`InviteStatus` from `libs/contracts`, `e2e/invites/invites.e2e.ts`, and a migration
dropping the table. ≈669 lines and one schedule.

### `chat` — the one that is correct

`ChatModule` is **not** in `app.module.ts`; it is reached only through
`game/game.module.ts:38`. That is right, not an omission. `ChatService` is injected at
`game/game.gateway.ts:109` (history on connect at :216, `record` at :617) and
`game/bots/game-bots.service.ts:99` (:227), and the FE consumes both
(`systems/network/useWebSocket.ts:201`, `components/game/Game.tsx:50,248`).

**Verdict: no change. A module with no controller and no gateway is the correct shape
here, and it is the counter-example to the rest of this section: unused is not the same
as HTTP-less.**

---

## 3 — The audit module

Three separable pieces:

| piece                                                | file                                                         | lines | who reads it                                             |
| ---------------------------------------------------- | ------------------------------------------------------------ | ----- | -------------------------------------------------------- |
| `AuditController` `GET /api/audit-logs` (admin)      | `audit/audit.controller.ts`                                  | 23    | **nobody** — no FE, no spec, no e2e                      |
| `AuditService` → `AuditLogRepository` → `audit_log`  | `audit/services`, `audit/repos`, `audit/schema`, `audit/dto` | 156   | only `AuditController` and `ProfileController.entries()` |
| `ProfileController` `GET /api/profile/audit` (admin) | `auth/profile.controller.ts:46-56`                           | 11    | **nobody**                                               |
| `AuditContextMiddleware`                             | `core/middlewares/audit-context.middleware.ts`               | 40    | the triggers                                             |
| `AuditTriggers`                                      | `infra/db/triggers.ts`                                       | 92    | writes `audit_log`                                       |

So: rows are written by SQLite triggers on every `INSERT`/`UPDATE`/`DELETE` of the
`user` table (`triggers.ts:10-16` — one table, four columns), attributed by a middleware
that runs on **every request**, and **nothing ever reads them**. There is no query and
no route with a caller.

Two extra reasons this is worse than merely unused:

- `AuditContextMiddleware.handle` issues `UPDATE _audit_ctx SET actor_id = ?` on **every
  request** (`triggers.ts:90`). That is a write to the single SQLite writer, on the same
  connection the 100 ms tick loop reads through, for a trail nobody reads. Its own doc
  comment concedes it races: "there is one SQLite connection and one context row, so
  interleaved requests can race."
- It is registered **app-level** (`app.module.ts:137`, listed at `http.options.ts:78`)
  specifically so it covers better-auth's own sign-up, which widens the blast radius of
  a per-request write to literally every route including `/api/health/*`.

After removing it, `DatabaseBootstrap` loses its only consumer: `DatabaseBootstrap` is
injected **only** by `AuditContextMiddleware` (`audit-context.middleware.ts:29`); the
health check takes `DbConnection`, not `DatabaseBootstrap`. So `DatabaseBootstrap.raw`
(the getter and the `instanceof SqliteConnection` guard,
`infra/db/database.module.ts:31-50`) becomes dead — flagged for workstream 04, not
touched here.

**Verdict: drop entirely.**

Files to delete:

- `apps/be/src/audit/audit.controller.ts`
- `apps/be/src/audit/audit.module.ts`
- `apps/be/src/audit/dto/audit-log.dto.ts`
- `apps/be/src/audit/repos/audit-log.repository.ts`
- `apps/be/src/audit/schema/audit-log.schema.ts`
- `apps/be/src/audit/services/audit.service.ts`
- `apps/be/src/core/middlewares/audit-context.middleware.ts`
- `apps/be/src/infra/db/triggers.ts`

References to remove:

- `apps/be/src/app.module.ts:5` (`AuditModule` import), `:8` (`AuditContextMiddleware`
  import), `:124` (`AuditModule` in imports), `:137` (`AuditContextMiddleware` in
  providers, and the doc comment above it)
- `apps/be/src/http.options.ts:13` (import), `:78` (middleware list entry)
- `apps/be/src/auth/auth.module.ts:14` (import), `:142` (`AuditModule` in imports), and
  the `AuditModule` paragraph in the doc comment at `:37-38`
- `apps/be/src/auth/profile.controller.ts:8-9` (imports), `:31` (constructor param),
  `:41-56` (the `/audit` route and its doc comment), and the now-unused
  `PaginationDirection`/`PaginationOrder`/`Page` imports at `:3-7`
- `apps/be/src/infra/db/schema.ts:5` (`auditLog`, `AuditAction`)
- `apps/be/src/infra/db/database.module.ts:15` (import), `:36`
  (`AuditTriggers.apply(this.connection.raw)`)

Migration: a new drizzle migration must `DROP TRIGGER` the six triggers
(`audit_user_insert|update|delete` — the names are generated from `AUDITED_TABLES`),
`DROP TABLE _audit_ctx`, and `DROP TABLE audit_log`. The triggers are created
imperatively (not by drizzle-kit), so `mig:gen` will not emit the `DROP TRIGGER`s —
they have to be hand-added to the generated file, and they must come **before** the
`DROP TABLE audit_log` or SQLite leaves triggers pointing at a missing table.
`0001_confused_ultimates.sql` is where `audit_log` was created.

---

## 4 — Is the profile controller used?

Yes, but one route out of four.

| route                               | line | evidence                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/profile`                  | :36  | **no FE caller.** The client resolves its session through better-auth's own `/api/auth/get-session` (`apps/fe/src/systems/auth/auth-api.ts:254`). Referenced only by tests: `users.spec.ts:70,187`, `infra/redis/redis.spec.ts:122,196`, `e2e/invites/invites.e2e.ts:65` |
| `GET /api/profile/audit`            | :48  | **zero callers repo-wide**                                                                                                                                                                                                                                               |
| `GET /api/profile/avatars/trending` | :67  | **live** — `apps/fe/src/components/ui/AvatarPicker.tsx:42`. One of only two `apiFetch` calls in the entire frontend                                                                                                                                                      |
| `GET /api/profile/anonymous`        | :85  | **no FE caller.** One test: `users.spec.ts:154`                                                                                                                                                                                                                          |

`/anonymous` is a demonstration of `@Public()` + `CurrentUser.optional()`, not a
feature: the socket already tells the client whether it is a spectator
(`context.player === null`), which is the only place the answer is acted on.

**Verdict: keep the controller — it is the home of the one live FE endpoint — but
shrink it.** Delete `/audit` with item 3 and delete `/anonymous`. Keep `GET /` (it is
the app-shaped session endpoint, five specs assert it, and it is four lines). Move the
controller and `AvatarsService` out of `AccountsModule` into a `ProfileModule` per
item 1, and give it the avatar upload from item 2 — which is what finally makes it a
feature rather than a leftover.

---

## 5 — Core throttle

### dunx 2.1.1 ships no throttle

`grep -ril "throttle|rate.?limit|ratelimit" packages/*/src` over all eight packages
returns exactly two hits, both minified vendor JS: `packages/dashboard/src/ui-bundle.ts`
and `packages/openapi/src/ui-bundle.ts`. There is no decorator, no middleware, no store,
no indicator, and nothing in `@dunx/infra`'s subpath exports (`db`, `redis`, `files`,
`images`, `schedule`, `queue`, `logger`, `pagination`).

### What firecracker has, and how much of it earns its place

- `core/decorators/throttle.decorator.ts` (25 lines) — `metaKey<ThrottleOptions>('throttle')`
  plus `meta()`. Built entirely from **public** `@dunx/http` API, which is the point its
  doc comment makes.
- `infra/redis/guards/throttle.guard.ts` (94 lines) — fixed window, `INCR` then `EXPIRE`
  only on the hit that created the key, key
  `${prefix}:throttle:${ctx.controller}:${ctx.handler}:${subject}`, subject = session
  user id → `ClientAddress` → `'anonymous'`, **fails open** with one warning per process.

Two things undercut it as it stands:

1. **`@Throttle` is used exactly once, and it is a no-op.**
   `files/files.controller.ts:58` declares `{ limit: 20, windowSeconds: 60 }`, which is
   character-for-character the config default (`THROTTLE_LIMIT` 20,
   `THROTTLE_WINDOW_SECONDS` 60, `config/dto/redis-vars.dto.ts:35-36`). The decorator
   changes nothing today.
2. **`THROTTLE_PREFIX` still defaults to `'dunx-template'`**
   (`config/dto/redis-vars.dto.ts:34`) — the exact failure CLAUDE.md calls out for
   `QUEUE_PREFIX`, `THROTTLE_PREFIX` and `WS_RELAY_CHANNEL`. Two firecracker-shaped apps
   in one Redis share a throttle namespace.

Minor, worth noting for the dunx version: the guard counts **unmatched** paths. With
`notFound: 'public'` a 404 reaches the chain, `ctx.controller` is `'(unmatched)'`, and
every miss is a Redis `INCR`. It does not lock a caller out of real routes (the key is
per-handler) but it is a round trip per 404.

**Verdict: the app cannot delete it today — dunx does not offer one. Fix the two
defects now (rename the prefix default, and either delete the no-op `@Throttle` or make
it genuinely stricter), and delete both files (119 lines) the moment
`@dunx/infra/throttle` lands.** The spec another agent can implement is in
[dunx asks](#dunx-asks).

---

## 6 — How much of `infra/` can go

2,195 lines across `infra/`, `core/` and `client/`. Directory by directory.

### `infra/db` — 335 lines (`database.module.ts` 126, `triggers.ts` 92, `tx.ts` 37, `columns.ts` 34, `seeds/` 29, `schema.ts` 17)

dunx already provides `DbModule.forRootAsync`, `SyncSqliteOptions`, `SqliteConnection`,
`DbConnection`, `SyncDatabase`. The wrapper adds four things: the pragma **order**
(`busy_timeout` first — CLAUDE.md documents the `SQLITE_BUSY`-at-boot crash it fixes),
`mkdirSync` of the SQLite file's parent, `migrate()` at construction, and
`AuditTriggers.apply()`.

**Verdict: must stay** — the pragmas are the concurrency design and boot-time migration
has to happen before any other provider is built. Two reductions only: `forRoot()` →
decorated `@Module({ global: true })` (≈8 lines), and `triggers.ts` (92) plus
`AuditTriggers.apply` go with item 3, after which `DatabaseBootstrap.raw` and its
`instanceof SqliteConnection` guard (≈14 lines) have zero consumers. **Workstream 04
owns this directory; this is a verdict, not a plan.** Saved: ≈114.

### `infra/redis` — 248 lines (`redis.module.ts` 49, `cache.service.ts` 105, `guards/throttle.guard.ts` 94)

`RedisModule.forRootAsync` is dunx's. The wrapper adds `maxRetries: 0` — load-bearing
per its own doc comment (a failed connect with retries keeps a timer alive past
`close()` and the process never exits on Bun 1.3.14) — and `global: true`.

`CacheService` (105 lines) has **no consumer anywhere except its own spec**:
`infra/redis/redis.spec.ts:130,165,178` and its own module registration. The two things
in this app that genuinely cache — chat scrollback and the throttle counter — talk to
`RedisConnection` directly. It is a read-through cache nothing reads through.

**Verdict: `redis.module.ts` thins to a decorated `@Module({ global: true })` (≈10
lines saved, `maxRetries: 0` stays). Delete `CacheService` and the `redis.spec.ts`
blocks that drive it (105 lines + spec).** `ThrottleGuard` is item 5. Saved: ≈115 plus
spec.

### `infra/queue` — 388 lines (`queue.module.ts` 110, `queues.controller.ts` 171, `queue-drain.service.ts` 63, `queue-unavailable.middleware.ts` 44)

`QueueModule.forRootAsync` is dunx's. The wrapper adds the absolute `PROCESSOR` path,
`isolation: 'process'` (a thread would miss the `@dunx/transform` preload),
`maxRetries: 0`, `consume` from config, and the module-scoped
`QueueUnavailableMiddleware`. All load-bearing, and `controllers` genuinely varies.

`QueuesController` (171) has zero FE callers; three of its five routes
(`POST .../jobs`, `.../retry`, `.../drain`) have no caller at all. It is a deliberate
operator surface advertised in the boot banner (`main.ts:131`) and README. **And dunx
already offers it**: `@dunx/dashboard` 2.1.1 is "one page over a running dunx app …
**with bull-board mounted for the queues**", with an `authorize` hook, mounted with one
module and one `app.use`. Firecracker does not depend on it.

**Verdict: `queue.module.ts` and `QueueDrain` must stay** (`QueueDrain` is bound purely
so its `onBeforeShutdown` fires; nothing injects it, deliberately).
**Replace `QueuesController` + `QueueUnavailableMiddleware` with `@dunx/dashboard`** —
215 lines and a hand-rolled ops UI traded for a dependency that also shows routes, the
container, gateways and config. Caveat: `infra/queue/queues.spec.ts:123-155` asserts
against those routes and has to be re-pointed or trimmed; the fork/consume assertions in
the same file are the part worth keeping. Saved: 215.

### `infra/schedule` — 48 lines

`SchedulesModule` wraps `ScheduleModule.forRootAsync` to add exactly three things:
`global: true`, `enabled` from the caller, and `tz` from config. The `global: true` is
load-bearing and CLAUDE.md is right about why — `CrashEngineService` and
`GameRoundWatchdog` both inject `ScheduleRegistry`, and two importers of a non-global
factory would be two registries and two copies of every schedule.

**Verdict: must stay as long as `ScheduleModule.forRootAsync` cannot be asked for
`global: true`.** That is a one-field dunx ask which would delete the file outright and
let `Foundation.for` call `ScheduleModule.forRootAsync` directly — `enabled` still
varies, so it stays a call with arguments, it just stops being firecracker's file.
Saved: 0 now, 48 after the dunx ask.

### `infra/health` — 196 lines (`health.module.ts` 103, `indicators.ts` 55, `service.controller.ts` 38)

`HealthModule.forRootAsync`, `DatabaseIndicator`, `MemoryIndicator`, `DiskIndicator`,
`RedisIndicator` and `Readiness` are all dunx's. Firecracker's own content is:

- `OptionalRedisIndicator` (2 lines of body) — flips `critical` to `false`. **Must
  stay** per CLAUDE.md, and the reason is sound: an absent Redis degrades a route, and
  no other replica has a Redis this one lacks. The ask that removes it is
  `new RedisIndicator(redis, { critical: false })` in dunx.
- `QueueIndicator` (27 lines) — reports `waiting`/`active`/`failed` for
  `QUEUES.NOTIFICATIONS`. Genuinely useful and genuinely generic; it belongs in
  `@dunx/infra/queue`, which is the second dunx ask.
- `ServiceController` (38) — `/api/service/config`, the commit sha. **Must stay**; no
  framework can know it.

**Verdict: thin to a config wrapper.** `forRoot()` → decorated `@Module` (≈8 lines).
With both dunx asks, `indicators.ts` disappears entirely (55). Saved: ≈8 now, ≈63 after.

### `infra/files` — 73 lines

Pure config wrapper over `FilesModule.forRootAsync`, choosing `S3StorageOptions` vs
`LocalStorageOptions` from `STORAGE_DRIVER` and `mkdir`-ing the local root (which is why
it must be async). Nothing here is reimplemented. Its only consumers are
`FilesService` and `MediaJobs`; the doc comment's claim about the health probe is stale.

**Verdict: survives only as long as item 2 keeps `files`.** Kept → decorated
`@Module({ global: true })` (≈8 lines saved). Files deleted → delete this too (73).

### `infra/images` — 32 lines

Same shape over `ImagesModule.forRootAsync`, passing `quality` and `maxWidth`. Note the
doc comment advertises `maxPixels` and `allowedFormats`, neither of which this factory
passes — stale. Only consumer is `ThumbnailsService`.

**Verdict: same as `infra/files`.** Kept → decorated (≈8 saved). Files deleted → delete
(32).

### Total

|                                | now      | after dunx asks |
| ------------------------------ | -------- | --------------- |
| `infra/db` (workstream 04)     | ≈114     | ≈114            |
| `infra/redis`                  | ≈115     | ≈115            |
| `infra/queue`                  | 215      | 215             |
| `infra/schedule`               | 0        | 48              |
| `infra/health`                 | ≈8       | ≈63             |
| `infra/files` + `infra/images` | ≈16      | ≈16             |
| **total**                      | **≈468** | **≈571**        |

**Verdict: about a fifth of `infra/` goes, but almost none of it for the reason the
bullet assumes.** The wrappers are not redundant — `maxRetries: 0`, the pragma order,
`isolation: 'process'`, `global: true` and `critical: false` are each a specific bug
that was fixed. What actually goes is _dead code inside_ `infra/` (`CacheService`, and
`triggers.ts` via item 3), one hand-rolled ops UI that dunx ships better
(`QueuesController` vs `@dunx/dashboard`), and the six zero-argument factory wrappers
from item 1. Three more files go only if dunx accepts two one-field options.

---

## 7 — "Fix dunx serving — 404 instead of 401"

### Reproduced

Real graph, `createTestServer`, in-memory SQLite, `QUEUE_CONSUME: 'false'`, a scratch
`CLIENT_DIST` containing `index.html` and `assets-abcdefgh.js`. Scratch specs live in
the session scratchpad, not the repo.

With the app's current `notFound: 'public'` (`http.options.ts:35`):

```
GET /nope            accept: text/html   → 404 {"error":"NOT_FOUND","status":404}
GET /nope            accept: json        → 404 {"error":"NOT_FOUND","status":404}
GET /api/nope                            → 404 {"error":"NOT_FOUND","status":404}
GET /api/users       (no session)        → 401 {"error":"UNAUTHORIZED","message":"UNAUTHENTICATED"}
GET /index.html                          → 200 text/html
GET /assets-abcdefgh.js                  → 200 text/javascript
GET /                accept: text/html   → 404   ← should be index.html
```

With dunx's default `notFound: 'guarded'`, the same server:

```
GET /leaderboard     accept: text/html   → 401 {"error":"UNAUTHORIZED","message":"UNAUTHENTICATED"}
GET /api/nope                            → 401
GET /assets-abcdefgh.js                  → 200
```

So both halves of the bullet are real and they are the **same bug seen from two sides**:
a SPA deep link never gets `index.html`. Under `'guarded'` it answers 401; under
`'public'` it answers a JSON 404. Neither is what a browser address bar needs.

### Root cause

`@dunx/http` expresses "nothing matched" by **throwing**, at the innermost handler of
the fallback chain (`packages/http/src/server/routes.ts:175-179`):

```ts
const miss: RouteHandler = () => {
  throw new HttpError(HttpStatusCode.NOT_FOUND, 'NOT_FOUND');
};
```

`compose` (`packages/http/src/server/middleware.ts:25-33`) is a plain `reduceRight` of
`current.handle(req, ctx, () => next(req))`, so a throw propagates straight through
every middleware to the outer `try`/`catch` in `buildFallback`, which hands it to
`onError`.

`SpaFallback` (`apps/be/src/client/client.module.ts:43-71`) inspects the **response**:

```ts
const response = await next();
if (response.status !== HttpStatusCode.NOT_FOUND) return response;
```

On an unmatched path `await next()` _throws_, so that line never executes. **The rewrite
branch is unreachable for exactly the case it was written for.**

A second, targeted experiment (bare dunx app, one middleware that logs whether `next()`
returned or threw, one controller route that _returns_ a 404 `Response`) shows the
inversion in full:

```
middleware observed: [ "threw 404", "returned 404" ]
unmatched  /deep/link      → 404 JSON            (rewrite skipped)
routed 404 /thing/missing  → 200 REWRITTEN       (rewrite applied)
```

So `SpaFallback` does the opposite of both halves of its doc comment: it never rewrites
an unmatched path, and it _does_ rewrite a real route's own 404 — the case the comment
promises is safe ("a real route's own 404 for a missing record is never replaced by a
page saying nothing is wrong"). Today no firecracker controller returns a bare 404
`Response`, so only the first half bites; the second is a live trap for the next one
that does.

`GET /` is the same bug in its simplest form: `StaticFiles.resolvePath('/')` resolves to
the root **directory**, `Bun.file(dir).exists()` is `false`, so it calls `next()`, the
miss throws, and the rewrite that would have served `index.html` never runs.

### Which repo owns the fix

**Firecracker.** Everything needed is already public API of `@dunx/http` 2.1.1:
`HttpError` and `HttpStatusCode` are exported, and so is `UNMATCHED`
(`packages/http/src/index.ts:30`) — the metadata key that no real route ever sets and
every miss does (`routes.ts:144-155`), which is exactly how a middleware tells "nothing
matched" from "a route said 404".

`SpaFallback` must catch rather than inspect, and gate on `UNMATCHED`. Verified working
against a real server:

```
deep link (html)      200 <!doctype html>…
deep link (json)      404 {"error":"NOT_FOUND","status":404}
api miss              404 {"error":"NOT_FOUND","status":404}
hashed asset          200 console.log(1)
routed 404 (returned) 404 gone                       ← left alone, as documented
routed 404 (thrown)   404 {"error":"no such record"}  ← left alone
```

The shape:

```ts
async handle(req: BunRequest, ctx: RouteContext, next: Next): Promise<Response> {
  try {
    return await next();
  } catch (error) {
    // A miss is a *throw* in @dunx/http, not a 404 response - see routes.ts's `miss`.
    // UNMATCHED is what separates it from a route that answered 404 itself.
    if (
      !(error instanceof HttpError) ||
      error.status !== HttpStatusCode.NOT_FOUND ||
      ctx.get(UNMATCHED) !== true
    ) throw error;
    // …the three existing conditions: GET, outside /api and /ws, accepts text/html
  }
}
```

The three existing guards stay exactly as they are and keep doing what their comments
claim; only the "how do I see the 404" mechanism changes.

Two things worth asking of dunx anyway, neither blocking: the `miss`-throws-rather-than-
returns asymmetry is undocumented and will catch every app that writes a fallback
middleware, and `StaticFiles` answering a directory request by falling through is
surprising. Both are in [dunx asks](#dunx-asks) as documentation/quality-of-life, not as
prerequisites.

### One more thing found while reproducing

`CLIENT_DIST` is read **twice, by two different readers with different emptiness
rules**: `app.module.ts:110` uses `(options.source ?? Bun.env)['CLIENT_DIST']` and
requires `length > 0` before importing `ClientModule`; `http.options.ts:75` uses the
validated `config.client.dist` and only checks `=== undefined`. `CLIENT_DIST=''` is
therefore a boot failure — the middleware list names `StaticFiles` while no module
provided `StaticOptions`:

```
StaticOptions cannot be constructed: parameter 1 (init: StaticOptionsInit) names
nothing that exists at runtime, so there is no token to resolve.
```

Fix with the same predicate on both sides: make `CLIENT_DIST` a
`z.string().trim().min(1).optional()` in `config/dto/service-vars.dto.ts:110`, so an
empty value validates to `undefined` and the two readers cannot disagree.

**Verdict: the root cause is in firecracker's `SpaFallback`, not in `@dunx/http`, and
not in the middleware order.** `@dunx/http` reports an unmatched path by throwing
`HttpError(404)` through `compose`, which no `await next()` can observe as a response;
`SpaFallback` reads a status off a response that never arrives, so SPA deep links have
never worked. `notFound: 'public'` only chooses which wrong status the caller sees
(404 instead of the framework default's 401). The fix is ~10 lines in
`apps/be/src/client/client.module.ts` using `UNMATCHED`, `HttpError` and
`HttpStatusCode`, all already exported. **Firecracker owns it. Nothing has to change in
dunx for this to be fixed.**

---

## Ordered implementation plan

Commit-sized, each independently shippable, ordered so nothing is deleted before its
last reference goes.

**Step 1 — Fix the SPA fallback (item 7).** The one user-visible bug.

- `apps/be/src/client/client.module.ts` — catch the thrown `HttpError` and gate on
  `UNMATCHED`; keep the three existing conditions; update the doc comment to say the
  miss is a throw and why.
- `apps/be/src/config/dto/service-vars.dto.ts` — `CLIENT_DIST` becomes
  `z.string().trim().min(1).optional()`.
- New `apps/be/src/client/client.spec.ts` — the test that would have caught it: with a
  temp dist, assert a deep link with `accept: text/html` is 200 `index.html`, `/api/nope`
  is 404 JSON, a hashed asset is 200, `GET /` is 200 `index.html`, and a route that
  returns its own 404 is left alone.

**Step 2 — Two throttle defects (item 5).** Small, unblocks nothing, costs nothing.

- `apps/be/src/config/dto/redis-vars.dto.ts:34` — `THROTTLE_PREFIX` default becomes
  `'firecracker'`.
- `apps/be/src/files/files.controller.ts:58` — delete the no-op `@Throttle` or lower it
  to a genuinely stricter value; if deleted, drop the now-unused import at `:4`.

**Step 3 — Drop the audit module (item 3).** The file list and reference list are in
item 3 above, plus the hand-edited migration.

- Delete: `apps/be/src/audit/` (6 files),
  `apps/be/src/core/middlewares/audit-context.middleware.ts`,
  `apps/be/src/infra/db/triggers.ts`.
- Edit: `apps/be/src/app.module.ts`, `apps/be/src/http.options.ts`,
  `apps/be/src/auth/auth.module.ts`, `apps/be/src/auth/profile.controller.ts`,
  `apps/be/src/infra/db/schema.ts`, `apps/be/src/infra/db/database.module.ts`.
- New migration in `apps/be/src/infra/db/migrations/` — `DROP TRIGGER` ×6 first, then
  `DROP TABLE _audit_ctx`, then `DROP TABLE audit_log`.
- Hand off to workstream 04: `DatabaseBootstrap.raw` and its `instanceof` guard now have
  no consumer.

**Step 4 — Delete the invites feature (item 2).**

- Delete: `apps/be/src/invites/` (6 files), `apps/be/e2e/invites/invites.e2e.ts`.
- Edit: `apps/be/src/app.module.ts` (import + registration),
  `apps/be/src/infra/db/schema.ts:7`, `libs/contracts` (`InviteStatus`),
  `apps/be/src/users/repos/users.repository.ts` only if it exposes an invites-only
  method.
- New migration dropping the `invites` table.

**Step 5 — Delete the AI controller and `CacheService` (items 2 and 6).**

- Delete: `apps/be/src/ai/ai.controller.ts`, `apps/be/src/ai/dto/ai.dto.ts`,
  `apps/be/src/infra/redis/services/cache.service.ts`.
- Edit: `apps/be/src/ai/ai.module.ts` (drop `AIModuleOptions` and the `controllers`
  branch), `apps/be/src/app.module.ts:58` (`AIModule` no longer takes options),
  `apps/be/src/infra/redis/redis.module.ts` (drop `CacheService`),
  `apps/be/src/infra/redis/redis.spec.ts` (drop the `CacheService` blocks).

**Step 6 — Decorate the zero-argument modules (item 1).** Mechanical, one commit.

- `apps/be/src/infra/redis/redis.module.ts`,
  `apps/be/src/infra/files/storage.module.ts`,
  `apps/be/src/infra/images/images.module.ts`,
  `apps/be/src/infra/health/health.module.ts`,
  `apps/be/src/notifications/notifications.module.ts`,
  `apps/be/src/ai/ai.module.ts` — each becomes a file-scope `const` plus
  `@Module({ global: true, … })`.
- `apps/be/src/app.module.ts` — the `forRoot()` calls in `Foundation.for` and
  `AppModule.forRoot` become bare class references.
- Leave `apps/be/src/infra/db/database.module.ts` to workstream 04.

**Step 7 — Split `AccountsModule` (item 1).**

- `apps/be/src/auth/auth.module.ts` — `@Module({ global: true, imports: [auth],
providers: [CurrentUser, AuthAdminSeeder], exports: [auth, CurrentUser] })`.
- New `apps/be/src/auth/profile.module.ts` — `ProfileController` + `AvatarsService`.
- `apps/be/src/app.module.ts` — register `ProfileModule`.
- Drop `imports: [AccountsModule]` from `apps/be/src/users/users.module.ts:17`,
  `apps/be/src/files/files.module.ts:41`, `apps/be/src/game/game.module.ts:38`
  (keep `ChatModule`).
- `apps/be/src/auth/profile.controller.ts` — delete the `/anonymous` route; adjust
  `apps/be/src/users/users.spec.ts:154`.

**Step 8 — Wire `files` to avatars (item 2).** The commit that makes `files`,
`StorageModule`, `ImagesConfigModule` and the sandboxed `media` queue load-bearing.

- `apps/be/src/auth/profile.controller.ts` — `POST /api/profile/avatar`, multipart,
  `FilesService.upload` → `users.image`.
- `apps/be/src/auth/profile.module.ts` — import whatever exports `FilesService`
  (`FilesFeatureModule` needs an `exports: [FilesService]`, which reverses the "nothing
  is exported" note in `files/files.module.ts:28` — update that comment).
- `apps/fe/src/components/ui/AvatarPicker.tsx` — an upload tab beside the trending list.
- New assertions in `apps/be/src/files/files.spec.ts`.

**Step 9 — Replace `QueuesController` with `@dunx/dashboard` (item 6).** Last, because
it adds a dependency and re-points a spec.

- Delete: `apps/be/src/infra/queue/queues.controller.ts`,
  `apps/be/src/infra/queue/queue-unavailable.middleware.ts`.
- Edit: `apps/be/src/infra/queue/queue.module.ts` (the `controllers` option now only
  gates the dashboard mount), `apps/be/src/infra/queue/queues.spec.ts` (keep the
  consume/fork assertions, drop the route ones), `apps/be/src/main.ts:131` (the boot
  banner link), `apps/be/package.json` (`@dunx/dashboard`), `README.md`.

---

## dunx asks

Written for the agent implementing dunx changes. **None of these blocks any step above.**
Item 7 in particular needs nothing from dunx.

### A. `@dunx/infra/throttle` — a first-party rate limiter (item 5)

New subpath export, mirroring `./schedule`. `@dunx/infra` must **not** gain a dependency
on `@dunx/auth`, which is why the subject resolver is an option rather than an injected
`AuthContext`.

```ts
export interface ThrottleLimit {
  readonly limit: number;
  readonly windowSeconds: number;
}

/** The metadata key, so an app can read it off a RouteContext like ROLES. */
export const THROTTLE: MetaKey<ThrottleLimit>;

/** Method or class scope. A handler's own value wins over its class's. */
export const Throttle: (
  limit: ThrottleLimit,
) => MethodDecorator & ClassDecorator;
export const SkipThrottle: () => MethodDecorator & ClassDecorator;

export abstract class ThrottleStore {
  /**
   * The count for this key in the current window, or `undefined` when the store
   * could not be reached - which the guard must read as "allow".
   */
  abstract hit(key: string, windowSeconds: number): Promise<number | undefined>;
}

/** ctor(RedisConnection). INCR, then EXPIRE only when the returned count is 1. */
export class RedisThrottleStore extends ThrottleStore {}
/** Single-process default, so an app with no Redis still limits something. */
export class MemoryThrottleStore extends ThrottleStore {}

export class ThrottleOptions {
  constructor(init: {
    readonly limit: number;
    readonly windowSeconds: number;
    /** REQUIRED. No default - see (4). Throw on an empty string. */
    readonly prefix: string;
    /** Default: `ClientAddress.of(req) ?? 'anonymous'`. */
    readonly subject?: (
      req: BunRequest,
      ctx: RouteContext,
    ) => string | undefined;
    /** Default true: RateLimit-Limit / -Remaining / -Reset and Retry-After on a 429. */
    readonly headers?: boolean;
  });
}

/** ctor(ThrottleOptions, ThrottleStore, ClientAddress, Logger). */
export class ThrottleGuard implements Middleware {}

export class ThrottleModule {
  /** global: true; exports ThrottleOptions, ThrottleStore and ThrottleGuard. */
  static forRoot(
    init: ConstructorParameters<typeof ThrottleOptions>[0],
  ): DynamicModule;
  static forRootAsync<const D extends Deps>(
    config: FactoryProvider<
      ConstructorParameters<typeof ThrottleOptions>[0],
      D
    >,
  ): DynamicModule;
}
```

Behaviour that must hold, each because firecracker's copy learned it:

1. **Fixed window, not sliding.** `INCR`, then `EXPIRE` **only** on the call that
   returned `1`. That is what makes the window start at the first hit instead of being
   pushed forward by every subsequent one. Two round trips, no Lua — `Bun.RedisClient`
   pipelines on its own.
2. **Fails open.** A store error allows the request and logs **once per process**, never
   once per request. An unreachable Redis must degrade a route, never become a 503.
3. **Key shape `${prefix}:throttle:${ctx.controller}:${ctx.handler}:${subject}`.**
   Per _handler_, not per path: two verbs on one path count separately, and a
   parameterised path does not fragment into a key per id.
4. **`prefix` has no default and an empty one throws.** firecracker inherited
   `'dunx-template'` from the template and shipped with it
   (`config/dto/redis-vars.dto.ts:34`), which puts two applications in one Redis on one
   throttle namespace. Same posture `QUEUE_PREFIX` deserves. Do not add a friendly
   fallback.
5. **Skip `UNMATCHED` contexts** (`ctx.get(UNMATCHED) === true`), or every 404 spends a
   caller's budget and costs a Redis round trip. firecracker's current guard does not,
   and that is a bug the framework version should not inherit.
6. **`@Throttle` at class scope applies to every handler; a handler's own value wins** —
   the same `mergeMeta` precedence `@Roles` already has.
7. **Throw `HttpError(429, …)`**, never return a `Response`. The 429 has to go through
   the app's `onError` so it carries the app's error shape.
8. Ordering is the app's business: document that the guard must be listed **after** any
   session guard, because only the guard ahead of it knows whether the subject is a user
   id or an address.

Firecracker deletes `core/decorators/throttle.decorator.ts` (25) and
`infra/redis/guards/throttle.guard.ts` (94) on the day this lands, and passes
`subject: (req) => currentUser.optional()?.id ?? address.of(req)`.

### B. `ScheduleModule.forRootAsync({ global: true })` (item 6)

One field on the existing options object. `ScheduleRegistry` is a singleton by nature —
two injectors of a non-global factory means two registries and two copies of every
schedule, which is why firecracker has a 48-line wrapper whose only job is
`global: true`. Adding the field deletes
`apps/be/src/infra/schedule/schedule.module.ts` entirely.

### C. `RedisIndicator` should take `critical` as an option (item 6)

```ts
new RedisIndicator(redis, { critical: false });
```

`RedisIndicator` is critical by default, which is right for an app whose sessions live
in Redis and wrong for one where an absent Redis degrades a route. Subclassing to flip
one boolean (`apps/be/src/infra/health/indicators.ts:13-15`) is the only way today.
Apply the same to `DatabaseIndicator`, `DiskIndicator` and `MemoryIndicator` for
consistency.

### D. Ship a `QueueIndicator` in `@dunx/infra/queue` (item 6)

`apps/be/src/infra/health/indicators.ts:28-54` is not app-specific except for the queue
name: it reports `waiting`/`active`/`failed` from `JobPublisher.queue(name).getJobCounts()`
alongside the redacted URL, and it is `critical: false` because a stalled consumer reads
identically to a healthy queue on a probe that only pings. Signature:
`new QueueIndicator(publisher, options, { queue: string; critical?: boolean })`. With C
and D, `indicators.ts` disappears (55 lines).

### E. Document that an unmatched path is a **throw** (item 7)

Not a code change; a doc change that would have prevented this bug outright. The
`buildFallback` doc comment (`packages/http/src/server/routes.ts:157-167`) explains that
global middleware now sees a 404, which reads as "you can inspect the response". It
cannot: `miss` throws and `compose` propagates. Say so explicitly, and say that
`UNMATCHED` on the `RouteContext` is how a middleware distinguishes a miss from a route
that answered 404 itself. A worked SPA-fallback example in the `StaticModule` doc
comment (which currently suggests `@Get('/*')` returning `Bun.file`) would close it.

Optional, lower value: consider having `StaticFiles` treat a request that resolves to a
**directory** as a miss explicitly rather than relying on `Bun.file(dir).exists()`
returning `false`, or offer an `index` option — `GET /` reaching a static mount at `/`
and falling through is surprising enough that firecracker's `GET /` was broken by it in
addition to the throw.
