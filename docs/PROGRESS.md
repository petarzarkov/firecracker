# Progress board

Branch: `refactor/architecture-sweep`. Baseline: `main` @ 55236e2.

Status vocabulary: `research` → `planned` → `in progress` → `done` / `blocked`.

| # | Workstream | Status | Notes |
|---|-----------|--------|-------|
| 01 | Contracts | planned | **3 live drift bugs found, 2 shipped**; 12-step plan; 11 raw `publish` holes |
| 02 | Game module | research | 4.8k lines, gateway alone is 649 |
| 03 | Module hygiene | research | audit/files/profile-controller usage unknown |
| 04 | Data layer | research | — |
| 05 | Noise reduction | queued | runs last, touches every file |
| 06 | Multi-replica | done | design doc delivered; found 2 single-replica bugs + a stale prefix |
| 07 | dunx framework | in progress | separate repo, prerelease target |
| 08 | dunx docs | in progress | separate repo |

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

## Decisions taken up front

- dunx changes land in `/home/petarzarkov/repos/dunx` and ship as a **prerelease**
  that firecracker then consumes. Not a local link.
- Firecracker executes, it does not just plan — except workstream 06.
- One branch, one commit per workstream, nothing pushed without a say-so.
- `.cursor/` deleted.
