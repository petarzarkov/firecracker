# Progress board

Branch: `refactor/architecture-sweep`. Baseline: `main` @ 55236e2.

Status vocabulary: `research` → `planned` → `in progress` → `done` / `blocked`.

| # | Workstream | Status | Notes |
|---|-----------|--------|-------|
| 01 | Contracts | next | **3 live drift bugs found, 2 shipped**; 12-step plan; 11 raw `publish` holes |
| 02 | Game module | next; bet-path gate now satisfied | 6 sub-modules + facade; 3 of 4 proposed merges rejected; 7 steps |
| 03 | Module hygiene | done | SPA fallback fixed; audit + invites + dead routes **deleted** (1244 lines) |
| 04 | Data layer | done | BaseRepository design typechecked at exit 0; migrations already correct |
| 05 | Noise reduction | planned | **3 secret-leak sites, fixed**; 27 info -> 5 survive; comments 22.4% |
| 06 | Multi-replica | done | design doc delivered; found 2 single-replica bugs + a stale prefix |
| 07 | dunx framework | **released as 2.2.0** | published, tagged, consumed here |
| 08 | dunx docs | done | 17 docs + README rewritten; **52 docs-vs-code discrepancies**, 4 likely code bugs |

## Live bugs found during research

Confirmed by hand, not taken on an agent's word.

1. `crashPoint` is rendered by the client on `/api/game/my-bets` and the server never
   sends it. Every lost or refunded row in MY BETS shows `×0.00x`.
   `apps/fe/src/components/game/PlayerHistory.tsx:48` against
   `apps/be/src/game/dto/game.dto.ts` (`GameBet` has no such field) and
   `game.controller.ts:49` (`#mapBet` never sets one).
2. The `chatMessage` handler *returns* `{error}`/`{delivered}`, so dunx replies under
   the inbound event name and the client — which registers no `chatMessage` listener —
   silently drops it. "Login required to chat" and the 1000-character rejection never
   reach a user. `apps/be/src/game/game.gateway.ts:588`. This is the exact thing
   CLAUDE.md says not to do: handlers *send* their acks.
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

The inversion is worse than the miss: a route that *returns* a 404 Response **is**
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
