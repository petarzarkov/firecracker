# Progress board

Branch: `refactor/architecture-sweep`. Baseline: `main` @ 55236e2.

Status vocabulary: `research` → `planned` → `in progress` → `done` / `blocked`.

| #   | Workstream      | Status                            | Notes                                                                             |
| --- | --------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| 01  | Contracts       | next                              | **3 live drift bugs found, 2 shipped**; 12-step plan; 11 raw `publish` holes      |
| 02  | Game module     | next; bet-path gate now satisfied | 6 sub-modules + facade; 3 of 4 proposed merges rejected; 7 steps                  |
| 03  | Module hygiene  | done                              | SPA fallback fixed; audit + invites + dead routes **deleted** (1244 lines)        |
| 04  | Data layer      | done                              | BaseRepository design typechecked at exit 0; migrations already correct           |
| 05  | Noise reduction | planned                           | **3 secret-leak sites, fixed**; 27 info -> 5 survive; comments 22.4%              |
| 06  | Multi-replica   | done                              | design doc delivered; found 2 single-replica bugs + a stale prefix                |
| 07  | dunx framework  | **released as 2.2.0**             | published, tagged, consumed here                                                  |
| 08  | dunx docs       | done                              | 17 docs + README rewritten; **52 docs-vs-code discrepancies**, 4 likely code bugs |

## Live bugs found during research

Confirmed by hand, not taken on an agent's word.

1. `crashPoint` is rendered by the client on `/api/game/my-bets` and the server never
   sends it. Every lost or refunded row in MY BETS shows `×0.00x`.
   `apps/fe/src/components/game/PlayerHistory.tsx:48` against
   `apps/be/src/game/dto/game.dto.ts` (`GameBet` has no such field) and
   `game.controller.ts:49` (`#mapBet` never sets one).
2. The `chatMessage` handler _returns_ `{error}`/`{delivered}`, so dunx replies under
   the inbound event name and the client — which registers no `chatMessage` listener —
   silently drops it. "Login required to chat" and the 1000-character rejection never
   reach a user. `apps/be/src/game/game.gateway.ts:588`. This is the exact thing
   CLAUDE.md says not to do: handlers _send_ their acks.
3. `notification` is published to two topics with four mutually inconsistent payloads
   and no client handler at all. `apps/be/src/notifications/handlers/notification.jobs.ts`.
4. `game.round.schedule` is enqueued with **no `jobId`**, at
   `apps/be/src/game/engine/crash-engine.service.ts:208` and
   `apps/be/src/game/services/game-watchdog.service.ts:120`, while `START` and `CRASH`
   both pass one. Two boots, or a watchdog firing while a boot is in flight, therefore
   start two rounds. Single-replica bug, live today.
5. A winning auto-cashout is settled as lost when the crash falls inside a restart gap.
   `min(current, target)` keeps a gap harmless only while the round is still running.
6. FIXED: `THROTTLE_PREFIX` and `WS_RELAY_CHANNEL` still defaulted to `dunx-template`
   and `.env` did not override them - the exact shared-Redis cross-talk CLAUDE.md
   warns about. `QUEUE_PREFIX` was already correct.

## Wrong comments found during research

Verified by hand. These matter because they are the reason the code reads the way it does.

1. `game.module.ts` claims `GameBetService` and `GameRoundService` reference each other
   and that Nest needed `forwardRef()` on both sides. There is no cycle: the round
   service imports and injects the bet service, and the bet service only does
   `import type { RefundedBet }` (`game-bet.service.ts:17`), which erases at build
   time. That comment is the main reason the module reads as un-splittable.
2. `GameModule`'s `exports: [GameRoundService, GameBetService, WalletService]` have no
   consumer anywhere outside `src/game/` - the only external hit is a mention inside a
   comment in `config/dto/db-vars.dto.ts`.
3. The gateway's `onInit` justifies itself with `GameModule.forRoot({ engine: false })`,
   which no longer exists.

## The 404/401 root cause

Firecracker owns this, not dunx.

`@dunx/http` signals an unmatched path by **throwing** `HttpError(404)` from the
innermost fallback (`packages/http/src/server/routes.ts:175`), and `compose`
propagates throws untouched (`server/middleware.ts:25`). `SpaFallback` inspects
`(await next()).status === NOT_FOUND` (`apps/be/src/client/client.module.ts:48`) - a
line that never executes on a miss, because `next()` threw. **SPA deep links have
never worked.** `notFound` only picks which wrong answer you get: `'guarded'` (the
dunx default) gives 401, `'public'` (what `http.options.ts:35` sets) gives 404 JSON.

The inversion is worse than the miss: a route that _returns_ a 404 Response **is**
rewritten to `index.html` - exactly the case the doc comment promises is protected.

Fix is about ten lines in the app, using `UNMATCHED`, `HttpError` and
`HttpStatusCode`, all already exported from `@dunx/http`. No framework change.

Related: `CLIENT_DIST=''` is a boot failure. `app.module.ts:128` gates the module on
`length > 0`, `http.options.ts:75` gates the middleware on `=== undefined`, so an
empty string registers `SpaFallback` without the module that provides it.

## Landed so far

- dunx **2.2.0** published, tagged and released; firecracker consumes it.
- Repositories are fully synchronous - `paginate` follows its driver now (831958f).
- The hand-rolled throttle is gone, 119 lines, replaced by `@dunx/http`'s (eebfa61).
- The bet path has coverage for the first time: 15 cases, row counts not balances
  (cebf7b3). It found a live defect on the way - see below.
- Wallet is its own top-level module with a required-`DbHandle` seam (348d020).
- Five of six hoisted-`const` module workarounds retired (7eec13b).
- The module graph is asserted to register nothing twice (4cf8496).

- Audit module, invites feature, dead AI controller and two dead profile routes
  deleted: **1244 code lines, 17 files**, two verified migrations
  (13f825c, ea5760e, 21bdea4, 52396f8). e2e went 38/8 to 32/0 - the 6 that went are
  the deleted invites tests.

- `THROTTLE_PREFIX` / `WS_RELAY_CHANNEL` renamed off `dunx-template` (801ddd6).
- SPA deep links fixed, with the spec that fails against the old mechanism (bdefb8c).
- Password-reset and invite links no longer logged (412b24b).

## Security: links in logs, fixed

`EmailService` logged the entire email body at `info` whenever `EMAIL_WEBHOOK_URL`
was unset - local, CI, and any deploy that forgot it. A password-reset body carries
better-auth's one-time link (`notification.jobs.ts:87`); an invite body carries a
code granting account creation **at the invited role**. A single test run leaked
four. `LOG_MASK_FIELDS` could never have caught it: it masks by field name, and a
token inside a URL string is not a field.

Two further sites logged the `url` directly. `auth.module.ts` is a deliberate
development affordance so it is gated on `nodeEnv`; `invites.service.ts` is not, so
it is gone.

## Decisions taken up front

- dunx changes land in `/home/petarzarkov/repos/dunx` and ship as a **prerelease**
  that firecracker then consumes. Not a local link.
- Firecracker executes, it does not just plan — except workstream 06.
- One branch, one commit per workstream, nothing pushed without a say-so.
- `.cursor/` deleted.

## Closed since that ledger was written

- **The fairness hole** (a2e08b7). A Redis failure no longer launches a round whose
  crash point came from the server seed alone. `combineClientSeeds([])` is the
  constant `'firecracker'`, so the degraded round was indistinguishable from an idle
  lobby's - which is why it was never noticed. Six cases in `fairness.test.ts`, three
  of which fail against the previous code.
- **The duplicate round.** The guard is on state in `GameJobs.schedule`, not on a
  `jobId`: bullmq dedupes against the completed set, so a fixed id would have stopped
  the eleventh restart scheduling anything.
- **`crashPoint` on `/api/game/my-bets`** (5b22495), with the join filtered on CRASHED
  **in SQL** - the column is written at the transition to RUNNING, so an unfiltered
  read would have leaked the outcome mid-round.
- **The chat ack** (1ff0f5e). Sent as `chatAck` rather than returned under the inbound
  name, and the client listens for it.
- **The invariant test** (f67b7ad). A name with no payload fails `bun test`; a payload
  with no name fails `bun run typecheck`. Both ends, all five payload maps.
- 9 raw `publish` holes closed; `GameEvents` deleted in favour of `publishGame`.
- Every suite has its own queue namespace, and the application's namespace goes from
  1686 keys to 0 after a full run.
- `info` reserved for lifecycle: 16 sites demoted, a test run goes from 32 log lines
  to 1.

## Still open

Two agents are working on the game-module split and the small leftovers. What
follows is what remained when that ledger was written, minus the above.

## What is actually left

Verified against the tree, not from memory, on 2026-08-20 after the second wave.

### Fairness, and the most serious thing found all day

`game-round.service.ts:154` swallows a Redis failure with
`.catch(() => ({}) as Record<string, string>)` and launches the round anyway. The
client-seed pool is then **empty**, so the crash point is drawn from the server seed
alone - the players did not influence it - and **nothing is logged**. A round that
looks provably fair, is recorded as provably fair, and is not.

That is a fairness hole, not a logging one. Workstream 05 flagged it as one of three
swallowed errors to promote; it deserves its own decision: log and continue, or
refuse to launch. **Not fixed.**

### Live user-facing bugs still open

- `crashPoint` is absent from the `GameBet` schema (0 occurrences), so every lost or
  refunded row in MY BETS still renders `x0.00x`. Workstream 01, step 1.
- `globalChat` still _returns_ `{ delivered }` / `{ error }`
  (`game.gateway.ts:589`), so dunx replies under the inbound name and the client -
  which registers no `chatMessage` listener - still drops it. "Login required to
  chat" and the 1000-character rejection still never reach a user.
- `GAME_JOBS.SCHEDULE` is still enqueued with **no `jobId`** at
  `crash-engine.service.ts:208` and `game-watchdog.service.ts:120`. Two boots still
  start two rounds. This was workstream 06's Stage 0, the cheapest fix on the list.
- A winning auto-cashout is still settled as lost when the crash falls inside a
  restart gap.

### Workstreams not started

- **01 contracts** - all 12 steps. The highest-value one is the last: a test
  asserting every event name has a payload and vice versa, which would have caught
  all three drift bugs.
- **02 game module split** - 23 files, gateway still 649 lines with its
  `oxlint-disable max-lines` header. The bet-path gate is now satisfied, so it is
  unblocked.
- **05 comments** - 31.5% of non-test `apps/be` lines are comment. The logging half
  is done; the ~1,184 lines of NestJS/Postgres archaeology are not.
- **05 websocket logging middleware** - dunx 2.2.0 ships it, the gateway does not use
  it, and `http.options.ts` still sets no `onError`, so a throwing socket handler
  still lands in dunx's `defaultOnError` as unstructured `console.error`.

### Smaller leftovers

- `scripts/migrate.ts` and `scripts/seed.ts` still open SQLite without
  `busy_timeout`, contradicting the pragma rule `database.module.ts` documents.
- Every bullmq sandbox child still re-runs `migrate()` per burst.
- 2 `SyncDatabase<typeof schema>` occurrences remain, in files their agent did not own.
- `infra/db/database.module.ts` still uses the hoisted-`const` module shape 2.2.0
  retired everywhere else.
- The files module is still unreachable - no client caller - so `infra/files`,
  `infra/images` and `MediaJobs` exist for nothing. The verdict was "wire it to avatar
  upload", and that was not done.
- `AIService.listAllModels` and `CACHE_TTL_SECONDS` are dead.
- `QueuesController` kept deliberately: `@dunx/dashboard` is real but not a dependency
  here, and deleting 215 lines would leave the boot banner advertising nothing.

### dunx

- 10 of 21 guides and 4 architecture docs are still unrewritten, and were flagged
  rather than skipped silently.
- Four flagged framework defects are unfixed by decision: no `x-request-id` on
  failure responses, the `OPTIONS` method-miss running the whole global chain,
  `override` of an unbound _class_ token binding silently, and `'trust proxy'`.
- PR #4, the monotonic-clock uptime fix, is open and unmerged.

### Unexplained

`page walks a cursor to the end and no further` in `base.repository.test.ts` has
failed twice in roughly forty runs and nobody has reproduced it. The test is
deterministic by construction, so the cause is elsewhere. Still open.

## Final state, 2026-08-21

The branch is **69 commits**. Source: 192 files, +8,345 / -4,507. Docs: 11 files,
+5,727. 24 files deleted, 12 new test files.

Green on every gate, verified from the repo root:

| Gate                   | Result                                                     |
| ---------------------- | ---------------------------------------------------------- |
| `bun run typecheck`    | exit 0, all four workspaces                                |
| `bun run test`         | contracts 11, stage 50, fe 9, be **228** - 0 fail anywhere |
| `bun run test:e2e`     | **33 pass, 0 fail**, five consecutive runs                 |
| `bun run lint:check`   | exit 0                                                     |
| `bun run format:check` | exit 0                                                     |

### Bugs found and fixed that nobody was looking for

1. A Redis failure launched a round whose crash point came from the server seed
   alone, recorded as provably fair, in a record indistinguishable from an idle
   lobby's.
2. Password-reset and invite links were logged in full at `info` whenever
   `EMAIL_WEBHOOK_URL` was unset - local, CI, and any deploy that forgot it.
3. The duplicate-bet catch matched an index name bun:sqlite never emits, so the one
   case the unique index exists for surfaced as a raw 500.
4. SPA deep links had never worked: the miss is a throw, and the fallback inspected
   a response.
5. `crashPoint` was rendered by the client and never sent.
6. Chat errors were replied under the inbound event name and silently dropped.
7. `game.round.schedule` had no dedupe, so two boots started two rounds.
8. Test suites shared the developer's queue namespace: 1686 orphaned keys, including
   61 delayed round-starts.
9. `THROTTLE_PREFIX` and `WS_RELAY_CHANNEL` still said `dunx-template`.
10. A throwing socket handler bypassed the structured logger entirely.

### Upstream

dunx **2.2.0** released - sync `paginate`, a throttle, websocket middleware, module
composition, and a teardown that finishes. PR #4 (monotonic-clock uptime) is open,
mergeable, CI green.

### Still open

- `reportedByMiddleware` in `@dunx/http` is `() => undefined`, so **any** socket
  middleware silences the console fallback whether or not it reports errors. Worked
  around here with an explicit reporter; the framework should warn at boot.
- 10 of 21 dunx guides and 4 architecture docs are unrewritten.
- Four flagged dunx defects unfixed by decision: no `x-request-id` on failures, the
  `OPTIONS` method-miss running the global chain, silent `override` of an unbound
  class token, `'trust proxy'`.
- The files module is still unreachable, so `infra/files`, `infra/images` and
  `MediaJobs` exist for nothing. Verdict was "wire it to avatar upload".
- `QueuesController` kept deliberately until `@dunx/dashboard` is a dependency.
- Multi-replica is a design document by decision; SQLite on local disk is the wall.
- Two unexplained flakes, both unreproduced: `page walks a cursor to the end` (twice
  in ~40 runs) and one e2e failure after the banners commit. Five consecutive clean
  e2e runs since.
