# 05 — Noise reduction

Workstream 05. Branch `refactor/architecture-sweep`. **Implemented last**: it touches
nearly every file in the repo, so it must land after 01–04 and 06 or every one of them
rebases through it.

The ask, as given:

> - We need to reduce the logging across the whole app — it is way too spammy.
> - Don't do random info logs across the app, verbose severity yes, but not info, may be debug somewhere.
> - Dunx offers a middleware for request/response in HTTP. Figure out a way to offer a middleware for websockets in the same manner.
> - Reduce comments overall.

Nothing here is a judgement call dressed as one. Every verdict below cites a rule
stated in §1, and every number cites the command that produced it in §2.

---

## 0. Headline numbers

| measure | now |
| --- | --- |
| logger call sites, `apps/be` + `apps/fe` + `libs` | **74** |
| — at `info` | **27** |
| — at `warn` | **29** |
| — at `error` | **10** |
| — at `debug` | **8** |
| — at `verbose` | **0** |
| — raw `console.*` | 6 (5 in `apps/fe`, 1 in `main.ts`) |
| JSON log lines printed by one `bun run test` | **32** (20 `info`, 6 `debug`, 4 `error`, 2 `warn`) |
| — of those, emitted by forked sandbox children | **31 / 32**, across **6** processes |
| JSON log lines printed by one `bun run test:e2e` | 0 |
| app `info` lines per game round, zero players, bots off | **5** |
| app `info` lines per hour, zero players (145 rounds/h) | **~725** |
| comment lines : code lines, whole repo | **4,980 : 17,234 = 22.4%** |
| — `apps/be/src` | 3,419 : 9,364 = **26.7%** |
| — `apps/fe/src` | 782 : 5,713 = 12.0% |
| — `libs` | 779 : 2,157 = 26.5% |
| comment blocks ≥ 15 lines | **51**, holding **998** comment lines (20% of all comments) |
| comment lines inside blocks that narrate the NestJS/Postgres/socket.io past | **1,184** (23.7% of all comments) |
| section-divider banners (CLAUDE.md explicitly bans these) | **8**, in 3 files, all `apps/fe` |
| markdown `##` headings inside doc comments | 37, in 29 files |
| commented-out code blocks | **0** |
| `TODO` / `FIXME` / `XXX` / `HACK` | **0** |

Three secret-bearing log statements. **§4, read that first.**

---

## 1. The rules

### 1.1 Logging

The levels are not a severity opinion, they are a **frequency contract**. What decides
the level is what bounds how often the line can be emitted.

| rule | statement |
| --- | --- |
| **L1** | **`info` is bounded by the number of deploys, not by traffic.** Boot, listening, shutdown, a migration applied, the first admin seeded, a config degradation that changes behaviour for the whole process. If a busy hour can produce more of these than a quiet hour, it is not `info`. |
| **L2** | **Anything bounded by traffic is `debug` at most.** Per request, per socket message, per job, per round, per bet, per email, per uploaded file. |
| **L3** | **Anything on a fixed clock is `verbose`, or nothing.** The 100 ms engine tick, the 250 ms bot poll, the per-tick auto-cashout sweep. A line on the 100 ms path emits 864,000 times a day whether or not anybody is playing. |
| **L4** | **A line the framework already writes for the same event is deleted, not demoted.** dunx already writes: one entry per HTTP request (`RequestLoggingMiddleware`), `Published job …` (debug), `Job completed …` (debug), `Job failed …` (error — **twice** for a sandboxed handler, once in the child and once in the parent), `Started […] worker for queue …` (info), `Sandboxed worker ready, N handler(s)` (info), `Schedules discovered but not armed` (info). |
| **L5** | **A durable record is not a log line.** A round is a row in `game_round`; a bet is a row in `game_bet`; a wallet movement is a row in the ledger. Re-emitting the row's identity to stdout is a second, worse copy of a record SQLite already holds — and it is *why* the game path is the loudest thing in the app. |
| **L6** | **An expected, handled failure is `debug`. An unexpected or swallowed one is `warn`/`error`.** "A truncated PNG has no dimensions" is expected. "A player is owed a refund and the wallet row is missing" is not. |
| **L7** | **A recurring degradation logs once, behind a latch.** `ThrottleGuard.#warned` (`apps/be/src/infra/redis/guards/throttle.guard.ts:78-88`) is the reference implementation: one line per outage, not one per attempt. Every "Redis is unreachable" line reachable from a loop or a clock gets this. |
| **L8** | **No payload dumps.** Log identifiers and counts. Never a message body, never a URL that contains a token or a code, never a whole result object, never the raw frame that failed to parse. |
| **L9** | **A constant message with structured fields, never a template.** `logger.error('provider call failed', { operation, provider })`, not `` logger.error(`${operation} failed on ${provider}`) `` — a templated message cannot be grouped or counted. |
| **L10** | **A swallowed error that costs correctness is promoted.** `catch {}` and `.catch(() => x)` are fine when the fallback is the designed behaviour, and a bug when the fallback silently weakens a guarantee. §3.4 lists the three that do. |

Applying L1 mechanically: **`info` survives in 5 places out of 27** — the boot banner
(`main.ts:104`), the first admin seeded, lobby bots enabled, and the engine's two
boot-time recovery lines. 15 demote to `debug`, 3 demote to `verbose`, 6 are deleted
outright, and 1 (`email.service.ts:54`) is restructured into a single boot `warn`.

### 1.2 Comments

Consistent with CLAUDE.md's Style section, which the codebase does not currently follow.

| rule | statement |
| --- | --- |
| **C1** | A comment explains **why**, or what would break if the line changed. A comment that restates the line is deleted. |
| **C2** | **No section-divider banners.** No `// --- Types ---`, no dashes, box-drawing or equals used to carve a file into regions. 8 exist; all 8 go. |
| **C3** | **A doc comment goes on the thing it explains.** A rule about `plugins` goes on `plugins`, not into a 30-line class essay the reader has to search. |
| **C4** | **Migration archaeology is not documentation.** "The NestJS version had two gateway classes", "That was `GAME` in `src/constants.ts`", "`axios` and `node-fetch` are banned" — this is history. It belongs in CLAUDE.md (where most of it already is, verbatim) or in `docs/`, once, not restated across 105 comment blocks. **Delete the archaeology sentence; keep the rule it was justifying.** That is per-sentence surgery, not per-block deletion. |
| **C5** | **A doc comment that needs `##` subheadings is an essay.** Either the rule fits in two sentences on the declaration it governs, or the class wants splitting (see workstream 02), or it belongs in CLAUDE.md. 37 headings in 29 files. |
| **C6** | **CLAUDE.md is not duplicated into source.** Where a class doc paraphrases a paragraph of CLAUDE.md, the source keeps a one-line pointer and CLAUDE.md keeps the prose. One copy cannot drift. |
| **C7** | **A comment that encodes a trap someone paid for is protected.** §6 is the list. When in doubt, keep — the cost of a stale comment is minutes, the cost of re-learning the BullMQ `jobId` trap is a day. |
| **C8** | Lint directives (`/* oxlint-disable … */`) and their justifications are code, not comments. They are never touched by this workstream. |

**The comment problem is not that the comments are bad.** Most are genuinely good
"why" comments — `auth.options.ts`, `libs/stage/src/types.ts` and
`database.module.ts` are all correct under C1. The problem is C3, C4, C5 and C6:
good reasons are stored in the wrong place, at the wrong length, three times over.
Target: **22.4% → ~14%**, by deleting ~1,600 comment lines, of which ~1,100 are
archaeology and CLAUDE.md restatement and **none** are on the §6 list.

---

## 2. Measurements, and the commands that produced them

Run every one of these before the first commit and after the last, and paste the diff
into the PR. They are the before/after.

```bash
# logging: call sites by level
cd /home/petarzarkov/repos/firecracker
grep -rEn '(this\.)?logger\.(error|warn|info|debug|verbose)\(|console\.(error|warn|log|info|debug)\(' \
  apps/be/src apps/fe/src libs --include='*.ts' --include='*.tsx' | wc -l          # 74
for l in info warn debug error verbose; do
  printf '%s: ' "$l"
  grep -rEc "logger\.$l\(|console\.$l\(" apps/be/src apps/fe/src libs \
    --include='*.ts' --include='*.tsx' | awk -F: '{s+=$2} END{print s}'
done                                              # info 27 warn 29 debug 8 error 10 verbose 0
# calls only — a bare `console\.` grep also matches comments that mention one, and returns 9
grep -rEn 'console\.(error|warn|log|info|debug)\(' \
  apps/be/src apps/fe/src libs --include='*.ts' --include='*.tsx' | wc -l          # 6

# logging: lines emitted by one test run
bun run test > /tmp/test-run.log 2>&1
grep -c '{"level"' /tmp/test-run.log                                # 32
grep -o '{"level":"[a-z]*"' /tmp/test-run.log | sort | uniq -c | sort -rn
grep -o '"message":"[^"]*"' /tmp/test-run.log | sort | uniq -c | sort -rn
grep -o '"pid":[0-9]*'      /tmp/test-run.log | sort | uniq -c | sort -rn   # 7 pids, 31/32 in 6 children
grep -c '"body":"Hello'     /tmp/test-run.log                       # 4  <-- email bodies in the log

bun run test:e2e > /tmp/e2e-run.log 2>&1
grep -c '{"level"' /tmp/e2e-run.log                                 # 0

# comments: ratio, overall and per file
cat > /tmp/count-comments.awk <<'EOF'
BEGIN { inblock=0 }
{
  line=$0; gsub(/^[ \t]+/,"",line); gsub(/[ \t]+$/,"",line)
  if (line=="") next
  if (inblock) { comment++; if (line ~ /\*\//) inblock=0; next }
  if (line ~ /^\/\//) { comment++; next }
  if (line ~ /^\/\*/) { comment++; if (line !~ /\*\//) inblock=1; next }
  code++
}
END { printf "%s\t%d\t%d\t%.1f\n", FILENAME, comment, code, (code>0 ? comment*100.0/(comment+code) : 100) }
EOF
for f in $(find apps/be/src apps/fe/src libs -type f \( -name '*.ts' -o -name '*.tsx' \) | sort); do
  awk -f /tmp/count-comments.awk "$f"
done > /tmp/comments.tsv
awk -F'\t' '{c+=$2;k+=$3} END{printf "comment=%d code=%d ratio=%.1f%%\n",c,k,c*100.0/(c+k)}' /tmp/comments.tsv
sort -t$'\t' -k2,2nr /tmp/comments.tsv | head -40      # worst first, by absolute comment lines

# comments: banned section-divider banners
grep -rnE '(//|/\*|\*)[[:space:]]*[-=_*#─━═│┌└╔~]{3,}' \
  apps/be/src apps/fe/src libs --include='*.ts' --include='*.tsx'      # 8, must reach 0

# comments: essay blocks and archaeology
grep -rn '^\s*\*\s*##\+ ' apps/be/src apps/fe/src libs \
  --include='*.ts' --include='*.tsx' | wc -l                           # 37 markdown headings
grep -rnE '^\s*(\*|//)' apps/be/src apps/fe/src libs --include='*.ts' --include='*.tsx' \
  | grep -icE 'nestjs|@nestjs|the template|socket\.io|postgres|passport|terminus|the old |used to'
                                                                       # 123 mention lines / 1,184 block lines

# comments: nothing commented out, nothing deferred
grep -rnE '^\s*//\s*(const|let|var|return|if|for|await|import|export|function|class)' \
  apps/be/src apps/fe/src libs --include='*.ts' --include='*.tsx'       # 0 real hits
grep -rnE '(TODO|FIXME|XXX|HACK)' apps/be/src apps/fe/src libs \
  --include='*.ts' --include='*.tsx' | wc -l                            # 0
```

### 2.1 What a test run actually prints, and why

`bun run test` prints 32 JSON log lines. **31 of them come from 6 forked sandbox
children**, not from the test processes:

```
6 × "Schedules discovered but not armed (enabled: false)"      info    (framework)
6 × "Sandboxed worker ready, 5 handler(s)"                     info    (framework)
6 × "Not opening workers: this container is a sandboxed job child"  debug (framework)
4 × "email not sent, no EMAIL_WEBHOOK_URL configured"          info    (app, WITH BODY)
4 × "handled user.registered"                                  info    (app)
3 × "Job failed …"                                             error   (framework)
2 × "thumbnail source is gone, not retrying"                   warn    (app)
```

The cause is one line. Every spec passes `AppModule.forRoot({ source, logLevel:
'fatal' })`, and `apps/be/src/app.module.ts:28-29` documents exactly why — "`fatal` in
tests, so a suite does not print one JSON line per assertion". **That option cannot
cross a fork.** `apps/be/src/jobs.processor.ts:38` builds the child graph as:

```ts
JobsModule.forRoot({ source: { API_PORT: '0', ...Bun.env } })
```

with no `logLevel`, so the child falls through to `LoggerModule.forRootAsync` and reads
`LOG_LEVEL` — `verbose` from `apps/be/.env` locally, `debug` from the schema default in
CI (`apps/be/src/config/dto/service-vars.dto.ts:40`). The child is loud by design and
nobody asked it to be.

`bun test` sets `NODE_ENV=test`, and a bullmq fork inherits the parent's environment
(verified). So the fix is one branch in `jobs.processor.ts`, and it lands in Batch 1.

### 2.2 What one round prints, and why that is the real problem

Redis is not up in this sandbox, so this is computed from the code rather than observed.
Five app `info` lines per round, on a box with **zero players and bots off**:

| line | level | site | fires |
| --- | --- | --- | --- |
| `game round created` | info | `game/services/game-round.service.ts:130` | `game.round.schedule` |
| `game round running` | info | `game/services/game-round.service.ts:180` | `game.round.start` |
| `engine ticking` | info | `game/engine/crash-engine.service.ts:187` | on the `start` engine command |
| `crash point reached` | info | `game/engine/crash-engine.service.ts:311` | on the tick that crosses |
| `active bets settled as lost` | info | `game/services/game-bet.service.ts:278` | `game.round.crash`, **with `lost: 0`** |

Round period = `GAME_WAITING_PHASE_MS` (10 s) + run + `GAME_COOLDOWN_MS` (5 s). Mean run
length, from the actual draw (`crashPointX100 = max(100, floor(99/(1-u)))`, 3% instant
crash) over the curve `e^(elapsed/10000)`:

```bash
awk 'BEGIN{srand(7); n=200000; for(i=0;i<n;i++){u=rand(); cp=(u<0.03)?100:int(99/(1-u)); if(cp<100)cp=100; s+=log(cp/100)*10000}
     printf "mean run %.0f ms, period %.1f s, %.0f rounds/h\n", s/n, (15000+s/n)/1000, 3600/((15000+s/n)/1000)}'
# mean run 9897 ms, period 24.9 s, 145 rounds/h
```

**145 rounds/hour × 5 = ~725 `info` lines/hour, ~17,400/day, at zero traffic.** With
`LOG_LEVEL=debug` (the schema default) the framework adds `Published job` ×3 and `Job
completed` ×3 per round, so the floor is ~1,600 lines/hour before a single player
connects. Every one of the five is a restatement of a row that was just written to
SQLite — rule **L5**.

After the verdicts in §3, a quiet box emits **zero** lines per round.

---

## 3. Logging verdicts

74 rows. `file:line` is relative to the repo root.

### 3.1 `apps/be` — game

| file:line | now | message | verdict | why |
| --- | --- | --- | --- | --- |
| `game/engine/crash-engine.service.ts:187` | info | `engine ticking` | **demote to debug** | L2, per round. The name also lies — it reads as per-tick. Rename to `round running`. |
| `game/engine/crash-engine.service.ts:207` | info | `no active round at boot, scheduling the first` | **keep at info** | L1, once per process, and the operator needs to know the loop was cold-started. |
| `game/engine/crash-engine.service.ts:223` | info | `recovered a waiting round` | **keep at info** | L1, boot-only recovery. |
| `game/engine/crash-engine.service.ts:238` | warn | `round should have crashed while we were down` | **keep at warn** | L1/L6, boot-only, a real anomaly with money attached. |
| `game/engine/crash-engine.service.ts:269` | error | `malformed engine command` | **keep at error, drop `message`** | L8 — it dumps the whole failed frame. Log its length and the channel. |
| `game/engine/crash-engine.service.ts:288` | error | `engine could not subscribe for commands` | **keep at error** | L1, boot-only, and the game is dead without it. |
| `game/engine/crash-engine.service.ts:311` | info | `crash point reached` | **demote to debug** | L2/L5, per round. The crash is a `game_round` row and a `gameCrashed` frame; stdout is the third copy. |
| `game/engine/crash-engine.service.ts:355` | warn | `could not enqueue a game job` | **keep at warn, latch** | L7. With Redis down this is once per round forever. |
| `game/services/game-round.service.ts:130` | info | `game round created` | **demote to debug** | L2/L5, per round. |
| `game/services/game-round.service.ts:174` | warn | `round was already started by another worker` | **demote to debug** | L6. The doc three lines above calls it the designed outcome — "one start and one no-op". A designed no-op is not a warning. |
| `game/services/game-round.service.ts:180` | info | `game round running` | **demote to debug** | L2/L5, per round. |
| `game/services/game-round.service.ts:232` | debug | `game round failed and refunded` | **keep at debug** | Already right; the comment there states the reason. Do not touch. |
| `game/services/game-round.service.ts:154-155` | *(silent)* | `hgetall(clientSeedsKey).catch(() => ({}))` | **PROMOTE to warn** | §3.4 #1. A Redis failure here launches the round with an **empty client-seed pool** — the crash point drawn from the server seed alone — silently. That is a fairness degradation with no trace. |
| `game/services/game-bet.service.ts:156` | info | `bet placed` | **demote to debug** | L2/L5, per bet. |
| `game/services/game-bet.service.ts:223` | info | `bet cashed out` | **demote to debug** | L2/L5, per cash-out. |
| `game/services/game-bet.service.ts:247` | error | `cannot refund a bet whose wallet is missing` | **keep at error** | L6. A player is owed money and did not get it. The one genuine error in the game path. |
| `game/services/game-bet.service.ts:278` | info | `active bets settled as lost` | **delete entirely** | L2/L5, fires every round with `lost: 0`. When non-zero the count is derivable from `game_bet`. If anything is wanted, fold `lost` into the demoted crash debug line. |
| `game/services/game-watchdog.service.ts:87` | debug | `failed a stuck round` | **keep at debug** | Correct already. |
| `game/services/game-watchdog.service.ts:95` | error | `could not fail a stuck round` | **keep at error** | L6, per-round failure inside a sweep, money attached. |
| `game/services/game-watchdog.service.ts:111` | warn | `failed stuck rounds` | **keep at warn** | Already one line per sweep behind the `stuck.length === 0` early return. This is the pattern, not the problem. |
| `game/services/game-watchdog.service.ts:121` | warn | `no live round after cleanup, restarted the loop` | **keep at warn** | L1-ish, rare and consequential. |
| `game/services/auto-cashout.service.ts:118` | debug | `auto-cashout skipped` | **demote to verbose** | **L3.** Inside the per-tick sweep: N pending entries × 10 ticks/s. The comment already says neither cause "is worth an error". |
| `game/services/wallet.service.ts:154` | info | `demo wallet reset` | **demote to debug** | L2/L4, per HTTP request; the request logger already has the line. |
| `game/services/player-chat.service.ts:165` | debug | `player chat announcement` | **delete entirely** | C1-for-logs: it logs that the line above ran. No information. |
| `game/handlers/game.jobs.ts:168` | warn | `engine command not delivered` | **keep at warn, latch** | L7. Three commands per round → 435/h with Redis down. |
| `game/bots/game-bots.service.ts:114` | info | `lobby bots enabled` | **keep at info** | L1, once at boot, off by default, and it changes what an operator sees in the lobby. |
| `game/bots/game-bots.service.ts:230` | debug | `bot chatter failed` | **demote to verbose** | L3. Cosmetic, on a 250 ms poll, and it fails on every attempt when no AI provider is configured. |
| `game/game.gateway.ts:131` | error | `auto-cashout sweep failed` | **keep at error, latch — highest priority** | L3/L7. This is on the 100 ms tick callback: a persistent failure emits **10 lines/second**. The worst single offender in the repo. |
| `game/game.gateway.ts:623` | debug | `socket closed` | **delete entirely** | L4 once the WS middleware in §5 exists; it owns connection lifecycle. |
| `game/game.gateway.ts:169-171` | *(silent)* | `getSession(…).catch(() => null)` | **PROMOTE to debug** | §3.4 #2. Every auth failure on upgrade silently becomes a spectator. A broken auth backend and a genuine visitor are indistinguishable. |
| `game/game.gateway.ts:320-326` | *(silent)* | `HSETNX` client seed `.catch(() => undefined)` | **PROMOTE to warn, latch** | §3.4 #3. A dropped seed means this player did not contribute entropy to the round they bet in — fairness, silently lost. |

### 3.2 `apps/be` — notifications, auth, users, invites, files, ai, infra

| file:line | now | message | verdict | why |
| --- | --- | --- | --- | --- |
| `notifications/services/email.service.ts:54` | info | `email not sent, no EMAIL_WEBHOOK_URL configured` | **§4 SECRET — restructure** | Drop `body`. Move the "not configured" fact to a single `warn` in `onInit` (L1: a mail transport that is not configured is a process fact, not a per-email one) and log nothing per email. |
| `notifications/services/email.service.ts:70` | info | `email sent` | **demote to debug** | L2/L4, per email, and `Job completed notifications[…]` already exists. |
| `notifications/handlers/notification.jobs.ts:61` | info | `handled user.registered` | **delete entirely** | **L4** — dunx logs `Job completed notifications[user.registered]` at debug for the same event. |
| `notifications/handlers/notification.jobs.ts:90` | info | `handled user.password-reset` | **delete entirely** | L4, same. |
| `notifications/handlers/notification.jobs.ts:123` | info | `handled user.invited` | **delete entirely** | L4, same, and it logs the invitee's address for nothing. |
| `notifications/events/events.publisher.ts:52` | warn | `socket frame not published` | **keep at warn, latch** | L7. `gameTick` publishes on the 100 ms clock, so once `PubSub` has no server this is 10/s until exit. The doc comment's choice of `warn` over silence is right and stays; the latch is what was missing. |
| `notifications/slack/slack.service.ts:81` | warn | `could not post to slack` | **keep at warn, latch** | L7. Best-effort transport; a silent outage still deserves one line. |
| `auth/auth.hooks.ts:38` | warn | `welcome notification not queued` | **keep at warn** | L6, per sign-up, degradation the user cannot see. |
| `auth/auth.module.ts:80` | warn | `password reset could not be queued` | **§4 SECRET — gate `url`** | The comment ("Log the link rather than failing the request — in development that is how you get it") is a deliberate dev affordance and a production leak. Keep the affordance behind `if (!isProd)`. |
| `auth/services/avatars.service.ts:47` | warn | `could not fetch trending avatars` | **demote to debug** | L6. Third-party CDN, `FALLBACK` covers it, purely cosmetic. |
| `auth/services/auth-admin.seeder.ts:51` | info | `seeded the first administrator` | **keep at info** | L1. Once ever, and an operator must see it. |
| `users/services/users.service.ts:82` | info | `user created` | **demote to debug** | L2/L4, per request. |
| `users/services/users.service.ts:91` | info | `user updated` | **demote to debug** | L2/L4, per request. |
| `users/services/users.service.ts:108` | warn | `user deleted` | **keep at warn** | L6. Destructive, admin-only, rare. Check `audit/` first: if the deletion is already an audit row, **delete** this line instead (L5). |
| `users/services/users.service.ts:131` | warn | `ban notification not queued` | **keep at warn** | L6. |
| `invites/services/invites.service.ts:88` | info | `invited a user` | **demote to debug** | L2/L4. |
| `invites/services/invites.service.ts:145` | info | `invitation accepted` | **demote to debug** | L2/L4. |
| `invites/services/invites.service.ts:170` | info | `expired stale invitations` | **demote to debug** | L3, hourly schedule. Already guarded by `expired > 0`. |
| `invites/services/invites.service.ts:191` | warn | `invitation email could not be queued` | **§4 SECRET — drop `url`** | The URL carries the invite code; the code is the credential. Keep the level, drop the field. |
| `files/services/files.service.ts:108` | info | `file uploaded` | **demote to debug** | L2/L4, per request. |
| `files/services/files.service.ts:151` | warn | `file deleted` | **demote to debug** | L6. A user deleting their own file is a successful operation, not a warning. Audit trails belong in `audit/`. |
| `files/services/files.service.ts:169` | warn | `thumbnail not queued, the queue is unreachable` | **keep at warn, latch** | L7. |
| `files/handlers/media.jobs.ts:59` | info | `thumbnail rendered` | **demote to debug, drop the spread** | L2/L4/L8 — `{ fileId, ...result }` dumps the whole result and `Job completed` already exists. |
| `files/handlers/media.jobs.ts:81` | warn | `thumbnail source is gone, not retrying` | **demote to debug** | L4/L6. The class doc calls it expected ("an upload rolled back"), and the `UnrecoverableError` it throws is already logged at `error` by dunx **twice** (child + parent). Three lines for one expected event. |
| `files/services/thumbnails.service.ts:36` | warn | `image metadata failed` | **demote to debug** | L6. The doc above it says "a truncated PNG is not an error here". |
| `ai/services/google.service.ts:93` | info | `gemini model hierarchy loaded` | **demote to debug** | L1 boundary case: once per process, but an optional subsystem, and it dumps the model list (L8). |
| `ai/services/google.service.ts:98` | warn | `could not list gemini models, using the defaults` | **keep at warn** | L1, boot-only, changes behaviour. |
| `ai/services/google.service.ts:183` | warn | `gemini quota reached, deranking` | **keep at warn** | L6. State change, and the quota rate-limits it for us. |
| `ai/services/google.service.ts:217` | info | `gemini cool-down elapsed, trying the best model again` | **demote to debug** | The paired recovery for a `warn`; not operator-facing on its own. |
| `ai/services/ai-provider.service.ts:124` | error | `` `${operation} failed on ${provider}` `` | **keep at error, constant message** | **L9.** The templated message cannot be grouped. `logger.error('ai provider call failed', { operation, provider, model, reason })`. |
| `infra/redis/services/cache.service.ts:76` | debug | `cache read skipped, the cache is unreachable` | **demote to verbose** | **L3.** Fires per cache read while Redis is down — unbounded by traffic, on read paths. |
| `infra/redis/guards/throttle.guard.ts:82` | warn | `the rate limiter is unreachable…` | **keep, unchanged** | Already latched on `#warned`. This is the L7 reference; other sites copy *this*. |
| `infra/queue/queue-drain.service.ts:53` | warn | `could not reach the queue runner to drain it` | **keep at warn** | L1, once per shutdown. |
| `infra/queue/queue-drain.service.ts:60` | debug | `draining queue workers while the server still answers` | **keep at debug** | L1/L2 boundary, once per shutdown, already debug. |
| `chat/services/chat.service.ts:57` | warn | `could not read chat history` | **demote to debug, latch** | L6/L7. Once per socket open while Redis is down. |
| `chat/services/chat.service.ts:84` | warn | `could not persist a chat message` | **demote to debug, latch** | L6/L7. Once per chat message while Redis is down. |
| `main.ts:76` | warn | CORS wildcard with credentials in prod | **keep at warn** | L1, boot, prod misconfiguration. |
| `main.ts:95` | warn | `openapi schema warnings` | **keep at warn, cap the array** | L1/L8. Boot-only, but log `count` plus the first three rather than the whole array. |
| `main.ts:98` | warn | `BETTER_AUTH_SECRET is unset…` | **keep at warn** | L1, boot, security-relevant. |
| `main.ts:104` | info | `<name> listening` + `links(…)` | **keep at info** | L1. The one boot banner. The 14-key object is fine at once-per-process. |
| `main.ts:144` | console.error | `[firecracker] boot failed` | **keep** | The comment states it: there may be no container to get a `Logger` from. |

### 3.3 `apps/fe` and `libs`

`libs` has **zero** logger call sites. `apps/fe` has 5 `console.*` and no logger — so
"reduce the logging across the whole app" is 95% a backend job.

| file:line | now | message | verdict | why |
| --- | --- | --- | --- | --- |
| `apps/fe/src/systems/network/useWebSocket.ts:108` | console.error | `[WebSocket] Connection error:` | **gate behind `import.meta.env.DEV`** | A reconnect storm prints one per attempt into a player's console. |
| `apps/fe/src/systems/network/useWebSocket.ts:120` | console.warn | `[WebSocket] Reconnection failed after max attempts` | **keep** | Terminal, once, and it explains a dead UI. |
| `apps/fe/src/systems/network/useWebSocket.ts:128` | console.error | `WebSocket error:` | **gate behind `import.meta.env.DEV`** | Same as :108, and it duplicates it in most cases. |
| `apps/fe/src/hooks/useDominantColor.ts:35` | console.warn | `Failed to extract color from avatar` | **delete entirely** | A CORS-blocked or missing avatar is normal, `defaultColor` covers it, and it fires per avatar in the player list. |
| `apps/fe/src/components/game/CrashChart.tsx:108` | console.error | `[stage] could not start` | **keep** | `libs/stage/src/stage.ts:45-56` documents that a PIXI init failure under SwiftShader "logs nothing" — this is the only clue. |
| `apps/fe/src/systems/network/socket.ts:188-192` | *(silent)* | `JSON.parse` of an inbound frame `catch { return }` | **PROMOTE to DEV-only console.warn** | A malformed frame is silently dropped — exactly the class of failure the four historical contract-drift bugs had. |

### 3.4 The three swallowed errors that must be promoted

These cost correctness, not tidiness. Each gets a test.

1. **`game/services/game-round.service.ts:154-155`** — `hgetall(clientSeedsKey)
   .catch(() => ({}))`. If Redis is unreachable at launch, `combineClientSeeds([])`
   produces the fallback seed and the crash point is drawn from the server seed alone.
   The round is still recorded as fair and still verifiable, but the players did not
   influence it. → `warn`, with `roundId`, once per outage. **This is the highest-value
   line in the whole workstream.**
2. **`game/game.gateway.ts:169-171`** — `getSession(…).catch(() => null)`. An expired
   token, a better-auth outage and a genuine anonymous visitor are the same code path.
   → `debug` with the reason only (never the token), carried by the §5 middleware.
3. **`game/game.gateway.ts:320-326`** — `HSETNX` `.catch(() => undefined)`. The
   player bet but contributed no entropy. → `warn`, latched, with `roundId`.

Everything else silent stays silent: `game.jobs.ts:103` (`del` of a spent key — leaks a
Redis key, no correctness cost), `auto-cashout.service.ts:74,83` (the `hdel` claim,
where `0` *is* the answer), `player-chat.service.ts:112`,
`chat.service.ts:66`, `ai.service.ts:76`, `openai-compatible.service.ts:115`,
`libs/stage/src/layers/{rocket,parachutes}.ts` (a missing texture is drawn without).

### 3.5 Sites that fire on a clock, ranked

The list the implementation should fix first, worst first:

1. `game/game.gateway.ts:131` — `error`, on the 100 ms tick callback. **10/s.**
2. `notifications/events/events.publisher.ts:52` — `warn`, published from the 100 ms tick. **10/s.**
3. `game/services/auto-cashout.service.ts:118` — `debug`, per entry per tick. **≥10/s.**
4. `infra/redis/services/cache.service.ts:76` — `debug`, per cache read. Traffic-bound.
5. `game/bots/game-bots.service.ts:230` — `debug`, on the 250 ms bot poll. **4/s.**
6. `game/handlers/game.jobs.ts:168` — `warn`, 3× per round. **~7/min.**
7. `game/engine/crash-engine.service.ts:355` — `warn`, ~1× per round.

All seven are Redis/publish failure paths, so all seven are quiet in a healthy process
and all seven turn one incident into a log flood. **They are the reason a latch helper
is Batch 2 rather than a per-site edit.**

### 3.6 Framework duplicates (L4), for reference

Do not "fix" these in the app; they are upstream behaviour. Listed so the
implementation recognises a duplicate when it sees one.

| what dunx already writes | level | source |
| --- | --- | --- |
| one entry per HTTP request, with status | info / warn (4xx) / error (5xx) | `@dunx/http` `RequestLoggingMiddleware` |
| `Published job <subject>` | debug | `@dunx/infra` queue publisher |
| `Job completed <subject>` | debug | queue worker |
| `Job failed <subject>` + stack | error | worker **and** sandbox child — **two lines per sandboxed failure** |
| `Started [where] worker for queue: X` | info | queue runner |
| `Sandboxed worker ready, N handler(s)` | info | job processor, **once per fork** |
| `Schedules discovered but not armed (enabled: false)` | info | schedule registry, once per child |
| `[dunx/http] <path> handler failed:` | **raw `console.error`** | `defaultOnError` — see §5 |

Two of these are worth raising upstream alongside the §5 middleware: `Sandboxed
worker ready` and `Schedules discovered but not armed` are `info` on a per-fork
event, which is L2 by dunx's own frequency logic. Not blocking; the app-side fix in
Batch 1 silences them in tests either way.

### 3.7 Configuration findings

| finding | detail |
| --- | --- |
| `LOG_LEVEL` default is `debug` | `config/dto/service-vars.dto.ts:40`. After this workstream, `info` is a genuinely quiet level, so the default should become **`info`**, with `debug` set explicitly in `apps/be/.env`. |
| `apps/be/.env` sets `LOG_LEVEL=verbose` | Louder than `.env.example`'s `debug`. Leave the dev file loud if the developer wants it, but the `verbose` tier only becomes useful once §3 has put things there. |
| **`apps/be/.env` `LOG_FILTER_EVENTS` is stale** | It names `/api/service/up,/api/service/health`. The real probes are `/api/health/live` and `/api/health/ready` (`constants.ts:20-24`), so the dev filter matches nothing. `.env.example` is correct. One-line fix. |
| `LOG_MASK_FIELDS` includes `key` | Which is why the test log shows `"key":"[MASKED]"` for an S3 object key — a false positive that hides a useful field. Consider dropping `key` and adding `token`, `authorization`, `url`, `body`. Field masking cannot help with §4 anyway: a token embedded in a URL string is not a field. |

---

## 4. Secrets in logs — urgent, fix in Batch 0

Three statements put a live credential into the log stream. Field masking does not and
cannot catch any of them: `LOG_MASK_FIELDS` masks by **field name**, and these are
either a field name not on the list (`url`, `body`) or a token embedded inside a
sentence.

### 4.1 `apps/be/src/notifications/services/email.service.ts:54` — the whole email body, at `info`

```ts
this.logger.info('email not sent, no EMAIL_WEBHOOK_URL configured', {
  to: email.to, subject: email.subject, body: email.body,
});
```

`EMAIL_WEBHOOK_URL` is unset in local development, in CI and in any deploy that forgot
it. Every email body then lands in the log at `info`. The bodies are built in
`notifications/handlers/notification.jobs.ts`:

- `passwordReset` (`:87`) — `use this link within the hour to choose a new password: ${url}`, where `url` is better-auth's **one-time reset link, token included**.
- `invited` (`:114`) — `Set your password here: ${url}`, where the URL carries the invite code; `notification.jobs.ts:91-96` says outright that "this job's payload is a credential".
- `banned` (`:134`) — the moderation reason, verbatim.

Reproducible right now: `bun run test` prints four of these
(`grep -c '"body":"Hello' /tmp/test-run.log` → 4). Anyone who can read the log can take
over an account whose reset was requested in the last hour.

Fix: delete `body` from the payload; move the "not configured" fact to a single `warn`
in `EmailService.onInit`; log nothing per email on the unconfigured path. The class doc
at `:20-22` says "with no URL configured it logs the message it would have sent" — that
sentence goes with the code, and the "degrade rather than fail" contract it defends is
kept by the `onInit` warning.

### 4.2 `apps/be/src/auth/auth.module.ts:80` — the password-reset URL, at `warn`

```ts
logger.warn('password reset could not be queued', { email: user.email, url, reason });
```

The comment above it is explicit that this is on purpose: *"With no Redis there is no
queue. Log the link rather than failing the request — in development that is how you get
it."* That is a good development affordance and a production account-takeover primitive,
in the same line. Reachable in production whenever Redis is unreachable.

Fix: keep the level and the message; include `url` only when
`!config.get('isProd')`. Keep a shortened version of the comment saying why the branch
exists — future-me will otherwise "simplify" the `if` away.

### 4.3 `apps/be/src/invites/services/invites.service.ts:191` — the invite URL, at `warn`

```ts
this.logger.warn('invitation email could not be queued', { email: invite.email, url, reason });
```

Same shape. The invite code grants account creation **at the role the invite named** —
`invites.service.ts:141-143` promotes the created user to `invite.role`, so a leaked
admin invite is an admin account. Fix: drop `url` unconditionally; the invite row is in
the database and an admin can re-issue.

### 4.4 Adjacent, lower severity

- **`main.ts:104`** — the boot banner prints `AUTH_MOUNT`, docs and queue URLs. Paths, not secrets. Fine.
- **`crash-engine.service.ts:269`** — `{ message }` is the raw channel frame, not a secret, but it is an unbounded attacker-influenced string in a log field. Drop it (L8).
- **`slack.service.ts:78`** — `Bearer ${this.#token}` is a request header, never logged. `HttpService` failures surface as a message, not headers. No action, but do not add a header dump.
- **`game.gateway.ts:143-165`** — the doc comment already says a `?token=` in a query string "lands in server access logs". `RequestLoggingMiddleware` logs the request path for the upgrade. Worth confirming with the §5 middleware author that the WS entry logs `path` **without** the query string. Not a finding yet; a requirement on the middleware.

---

## 5. WebSocket middleware — spec for the dunx-side author

### 5.1 The finding

`apps/be/src/game/game.gateway.ts` is 649 lines: 149 comment, 438 code, 62 blank.
**It contains exactly two logger calls, totalling 8 lines** — `logger.error` on line
131 and `logger.debug` on line 623. So the honest answer to "how much of the 649 lines
is logging" is **1.2%**, and the interesting number is the other one:

> The gateway does not log the socket by hand. **Nothing does.** There is no
> per-message observability at all.

Invisible today, on the app's only realtime surface:

| event | how many places | what an operator sees now |
| --- | --- | --- |
| a socket upgraded, authenticated or anonymous | 1 (`upgrade`, :167-185) | nothing |
| an auth failure on upgrade | 1 (`.catch(() => null)`, :171) | nothing — becomes a spectator |
| a socket opened, and what it subscribed to | 1 (`opened`, :187-247) | nothing |
| an inbound frame, by event name | 8 `@OnMessage` handlers | nothing |
| a frame rejected for no session | 7 `player === null` guards | nothing |
| a frame rejected as unparseable | 6 `parseX(…) === null` guards | nothing |
| a business rejection (`{ success: false, error }`) | 12 sites | nothing |
| an ack sent, and under which name | 5 `#reply` calls | nothing |
| a handler that throws or rejects | any of 8 | **raw `console.error`** — see below |
| a socket closed, with code | 1 (`closed`, :621-629) | one `debug` line |

The throwing case is the sharp one. `@dunx/http`'s dispatcher settles every handler
through `SocketOptions.onError`, defaulting to:

```js
var defaultOnError = (error, socket) => {
  console.error(`[dunx/http] ${socket.data.path} handler failed:`, error);
};
```

`apps/be/src/http.options.ts:43` configures `websocket: { idleTimeout: 60 }` and no
`onError`, so **every WS handler exception in production is an unstructured console
line** — not JSON, no level, no `requestId`, unmasked, invisible to `LOG_LEVEL` and to
`LOG_FILTER_EVENTS`. And it is reachable: `game.gateway.ts:495-499` (`submitSeed`) calls
`redis.hset` and `redis.expire` with no `.catch`, so a Redis blip there goes straight to
`console.error`.

Adding all of the above by hand would mean roughly **14 new logger call sites** inside
the gateway, each with a level judgement, each duplicated across eight handlers. That is
what the middleware is for — and it is the same argument
`RequestLoggingMiddleware`'s own doc makes for the HTTP side: *"they are the same
closure, so there is no pair to correlate by `requestId`."*

### 5.2 What the middleware must cover

Frequency budget first, because it is the whole point (rules L1–L3): a gateway
publishing `gameTick` ten times a second must not produce ten lines a second.

| phase | level | fields | notes |
| --- | --- | --- | --- |
| upgrade accepted | `debug` | `path`, `authenticated: boolean`, `connectionId` | **`path` without the query string** — `?token=` is a session token (`game.gateway.ts:143-165`). |
| upgrade refused (handler returned a `Response`) | `debug` | `path`, `status` | Never `warn`: the gateway admits anonymous callers by design. |
| upgrade **threw** | `error` | `path`, `reason` | Today: silently `{ player: null }`. Promote #2 in §3.4 lands here for free. |
| open | `verbose` | `connectionId`, `subscriptions` count | L3 — one per connection is traffic-bound; `verbose` keeps it out of a normal day. |
| inbound frame, handled | `verbose` | `event`, `bytes`, `durationMs` | **Never the payload** (L8). Frame counts belong on a metric, not a log line. |
| inbound frame, **no handler claimed it** | `debug` | `event` (or `unparseable`), `bytes` | The contracts-drift signal. A client emitting an event the server does not route is exactly the bug class CLAUDE.md describes. |
| outbound frame | `verbose` | `event`, `bytes` | Must be suppressible independently: `gameTick` alone is 10/s per socket. |
| handler threw or rejected | `error` | `event`, `connectionId`, `reason`, stack | **Replaces `defaultOnError`.** Structured, through `Logger`, masked. |
| close | `debug` | `connectionId`, `code`, `durationMs` | Replaces `game.gateway.ts:621-629` verbatim, plus the duration the gateway cannot compute. |
| backpressure / drain | `warn`, latched | `connectionId` | Not observable at all today. |

Options, mirroring `RequestLoggingOptions` so an app author does not learn two shapes:

```ts
websocket: {
  idleTimeout: 60,
  logging: {
    /** Log inbound frame payloads. Default false — same reason requestBody is. */
    messageData?: boolean;
    /** Log outbound frame payloads. Default false. */
    replyData?: boolean;
    /** Payloads past this many characters are logged as a size. Default 2048. */
    maxDataLength?: number;
    /** Event names to skip entirely. `['gameTick']` is the motivating case. */
    ignoreEvents?: readonly string[];
    /** Gateway paths to skip entirely. */
    ignorePaths?: readonly string[];
    /** Wrap each frame in an AsyncLocalStorage scope so a service four frames down
     *  carries connectionId without being handed the socket. Default true. */
    correlate?: boolean;
  },
}
```

Hard requirements:

1. **It must not require a second connection or a second gateway.** dunx mounts a
   gateway as a route and two gateways on one path is a boot error; the middleware
   wraps dispatch, it does not add a participant.
2. **`onError` must route through `Logger`, not `console`.** This is the single
   highest-value item in the spec — it is the only one that fixes a production
   blind spot rather than moving a line between levels.
3. **A `connectionId`** minted at upgrade and carried on every entry for that socket,
   the way `requestId` works on the HTTP side. Without it the entries cannot be joined.
4. **Zero allocation on the suppressed path.** Same guard `ignore` has on the HTTP
   side: an app that logs nothing pays nothing. `gameTick` × 10/s × N sockets is the
   benchmark to beat.
5. **Payloads off by default**, for `LOG_REQUEST_BODY`'s reasons plus one more: chat
   messages and DMs cross this socket.
6. **It must not swallow.** `settle`'s current contract — a throwing handler does not
   kill the socket — is preserved exactly.

Natural wiring point: `buildWebSocket` in `@dunx/http`'s `ws/adapter.ts`, where
`run(invoke, args, ws, then)` already wraps every dispatch and `onError` is already
resolved. The app side is then one field in `apps/be/src/http.options.ts:43`.

### 5.3 What the app deletes once it exists

| site | lines | replaced by |
| --- | --- | --- |
| `game.gateway.ts:621-629` — `closed()` and its `logger.debug` | 9 | the middleware's close entry. The `#broadcastUserCount()` call **stays** — it is behaviour, not logging. |
| `game.gateway.ts:114` — `private readonly logger: Logger` | 1 | only after :131 is dealt with (§3.1 keeps it, latched) |
| `game.gateway.ts:169-171` — silent `.catch(() => null)` | 0 (behaviour change) | the middleware's "upgrade threw" entry |
| `http.options.ts:43` | +1 | `websocket: { idleTimeout: 60, logging: { ignoreEvents: ['gameTick'] } }` |

Net effect on the gateway: **−9 lines of code, and roughly 14 logger call sites never
written.** That is the honest accounting — the middleware's value here is the logging
the gateway *should* have and does not, not the two lines it does.

### 5.4 Not the middleware's job — but adjacent, and in scope for this workstream

While reading the gateway for logging, four hand-rolled transport patterns turned up.
They are noise of a different kind and they belong to **workstream 02** (game module
decomposition), not here. Listed so nobody plans them twice:

- `#reply` (`:249-268`) and its 5 call sites, plus 4 raw `socket.send(JSON.stringify(…))` blocks in `opened()` (`:203-245`) — ~40 lines of hand-built envelopes. The `#reply` doc comment is **protected** (§6).
- 7 `if (player === null) return …` guards — a per-handler `requiresPlayer` concern.
- 6 `parseX(data) === null` guards — a per-handler schema, the way HTTP routes already declare one.
- 2 `try/catch` → `GameMessages.playerFacing(error, …)` pairs — one error mapper, the way `ErrorMapper.toResponseBody` is one for HTTP.

---

## 6. Protected comments — do not touch

**Read this before deleting a single comment.** Every entry encodes something someone
paid for. If a comment is on this list, it is not shortened, not moved into CLAUDE.md,
and not "tidied". Where a protected comment *also* contains archaeology, the
archaeology sentence may go and the rule must stay.

| file:lines | what it protects |
| --- | --- |
| `game/services/game-watchdog.service.ts:17-34` | **The BullMQ `jobId` trap.** A fixed id was needed in one direction (or ten restarts meant ten loops) and *no* id in the other (a just-completed job with that id deduplicates the next). Deleting this invites putting the sweep back on the queue. |
| `game/services/game-watchdog.service.ts:102-110` | Why the sweep logs **one line per sweep, not per round** — the exact mistake this workstream is fixing everywhere else. |
| `game/services/game-watchdog.service.ts:58-59`, `:93-94` | Why the registry never rethrows, and why the per-round failure stays at `error`. |
| `game/services/game-round.service.ts:44-53` | **Why the server seed is `crypto.getRandomValues` and deliberately not `@arkv/rng`** — every `@arkv/rng` algorithm is a PRNG whose state is recoverable from published outputs. |
| `game/game.math.ts:11-16` | `rngAlgorithm` is stored per round, so changing the default cannot retroactively invalidate history. |
| `game/game.math.ts:71-84` | **Why the crash point is a seeded PRNG and still provably fair**, and why the old HMAC slice was worse. Contains a Postgres reference — keep it; it is the comparison that makes the argument. |
| `game/game.math.ts:34-41` | `Math.floor`, not `round`: rounding up shows a multiplier the round never reached, and the number on screen is the number paid. |
| `game/game.math.ts:46-53` | Why the payout multiplies by hundredths before dividing — the float bug that paid 199 on a 2.00x. |
| `game/game.math.ts:96-97`, `:107-110` | One `float()` draw decides both outcomes; `rng.free()` because WASM memory is not GC'd and this runs forever. |
| `infra/queue/queue.module.ts:28` (+ `:75`) | **`isolation: 'process'` and never `'thread'`** — a fork reads `bunfig.toml` so `@dunx/transform/preload` runs; a thread enters through BullMQ's prebuilt `main-worker.js` where it never matches a `.ts` file. |
| `infra/db/database.module.ts:63-90` | **The pragmas are the concurrency design**, including that `busy_timeout` must be **first** because switching journal mode itself takes a lock, and that every pragma after a failing one is silently skipped. 39 lines, the largest block in the repo, and every line earns it. |
| `infra/db/database.module.ts:103` | `// Order matters - see the note above.` — the one-line pointer that makes the block above findable from the code. |
| `infra/health/indicators.ts:5-12` | **Why `OptionalRedisIndicator` exists**: `RedisIndicator` is critical by default; readiness sheds traffic so another replica can take it, and no other replica has a Redis this one does not. |
| `infra/health/indicators.ts:17-26` | Why `QueueIndicator` is `critical: false` *and* reports counts — "up" is not the question during an incident. |
| `game/bots/game-bots.service.ts:67-87` | **Why the bots have no repository and no `GameBetService`** — a bot placing real bets would contribute entropy to the crash point through the client-seed pool. The absence of two constructor parameters is the enforcement; without this comment it reads as an oversight. |
| `game/bots/game-bots.service.ts:118-126` | Why it polls the engine rather than hooking it, and why `Overlap.SKIP` matters. |
| `game/bots/game-bots.service.ts:21-27` | Why `BOT_PERSONA` tells the model not to explain itself. |
| `game/game.spec.ts:32-34` | **Why `QUEUE_CONSUME: 'false'`** — this graph includes the engine, which enqueues the first round at `onInit`, so a consuming test server starts the clock under the assertions. Also present in `users.spec.ts:31`, `files.spec.ts:59`, `redis.spec.ts:24`, `openapi.spec.ts:27`; `queues.spec.ts:46` is the deliberate exception. Keep all six. |
| `jobs.processor.ts:22-37` | **The `API_PORT` CI trap.** A spec's in-memory config literal cannot cross a fork, so the child read `Bun.env`, and with no `apps/be/.env` in CI it died on `API_PORT: NaN` — surfacing as a job's `failedReason`, not as a boot error. This is also the file Batch 1 edits; **the comment stays and gains one sentence.** |
| `jobs.processor.ts:5-20` | Why nobody runs this file, and why a WebP encode and an SMTP round trip do not belong on the 100 ms loop. |
| `engine/crash-engine.service.ts:335-346` | **`#enqueue` must never throw** — `onInit` runs during boot, so a rejecting enqueue against an unreachable Redis takes the process down and breaks the "absent Redis degrades a route, never the graph" contract. A test caught it. |
| `engine/crash-engine.service.ts:175-177` | **Disarm before arming**: the registry refuses a duplicate name, so a repeated `start` command would throw on the pub/sub path instead of re-arming. |
| `engine/crash-engine.service.ts:116-122` | Read `currentMultiplierX100()` **synchronously and pass the value on** — re-reading after an `await` pays what the curve climbed to, not what the player saw. |
| `engine/crash-engine.service.ts:196-202` | The three recovery cases, and why a round that should have crashed is crashed rather than resumed. |
| `engine/crash-engine.service.ts:257-261`, `:286-287` | `RedisConnection.subscribe` opens its own second connection; a Redis-down boot degrades the game, not the process. |
| `engine/crash-engine.service.ts:84`, `:316-317` | Why `TICK` is a fixed name; why the crash enqueue is fire-and-forget. |
| `game/game.gateway.ts:1-6` | The `oxlint-disable max-lines` justification. **A lint directive — C8, never touched.** |
| `game/game.gateway.ts:249-261` | **The ack-name trap.** dunx replies to `@OnMessage('x')` by sending the return value back under `x`, so returning an ack from `placeBet` reaches the client as `placeBet` and the client listens for `betAck`. An e2e test caught it; without it every ack in the UI is silently dropped. |
| `game/game.gateway.ts:143-165` | Why `?token=` exists, why it must be **percent-encoded** (base64 contains `/`, `+`, `=` and an unencoded `+` arrives as a space), and why it is not a pattern for an HTTP route. |
| `game/game.gateway.ts:76-81` | Why the upgrade **must not** refuse anonymous callers. |
| `game/game.gateway.ts:397-408` | **Which wallet is decided by the bet, not the client.** `BetPanel` sends a bare `cashOut` with no payload, so defaulting to real money rejected every demo cash-out — silently, because a rejection is an ack. That shipped. |
| `game/game.gateway.ts:604-612` | `picture` was dropped in the migration, so every chat line showed a letter where a face had been. |
| `game/game.gateway.ts:117-124` | Why the auto-cashout callback is registered here and not injected into the engine. |
| `game/game.gateway.ts:200-202`, `:210-212`, `:221-223` | Why three frames go straight down the socket rather than being published, and why the `{ payload }` envelope shape is the client's to dictate. |
| `game/game.gateway.ts:489-490` | Client seeds keyed by user, so a player cannot stuff the pool one seed per socket. |
| `game/game.gateway.ts:366-371`, `:540-541`, `:569-571`, `:601-603`, `:631-636` | Read-before-await ordering; why subscribing lives in the gateway; why `send` re-checks membership; why the chat line is recorded before publishing; why `subscriberCount` is per-node. |
| `game/services/game-bet.service.ts:32-60` (class doc) | **There is no advisory lock and none is needed**: `transactionSync` cannot yield, the debit is guarded in SQL (`WHERE balance_cents >= ?`), and the unique index catches the cross-process double bet. |
| `game/services/game-bet.service.ts:225-228`, `:250-253` | The duplicate-bet race arriving as a unique-index violation with the transaction already rolled back; why `refundBetsForRound` takes a non-optional `tx`. |
| `game/services/game-round.service.ts:137-142`, `:188-194` | Why `transitionToRunning` is conditional (a retried job must not launch twice); why `settleCrash` is one synchronous transaction. |
| `game/services/game-round.service.ts:226-228` | Why the failed-round line is `debug` and not `warn` — it was the second half of the two-per-round pair that made the watchdog unreadable. Directly relevant to this workstream. |
| `game/services/auto-cashout.service.ts:80-84` | **Claimed before the payout, not after** — this runs every tick, and a slow write lets the next tick pay the same bet twice. `hdel` returning 0 means another tick won. |
| `game/handlers/game.jobs.ts:22-37` | Why the transitions are jobs even with one consumer (retry), that idempotency comes from `transition`'s `WHERE` and not a `try/catch`, and why this queue is **not** `background`. |
| `game/handlers/game.jobs.ts:60-63`, `:96-97`, `:161-163`, `:138` | Why the payload spreads rather than assigns (`exactOptionalPropertyTypes`); why seeds are dropped after the draw; why the command publish is fire-and-forget; what the reveal is for. |
| `notifications/events/events.publisher.ts:6-18` | Why `EventsPublisher` is an abstract class and not an interface — a dunx constructor parameter must name a runtime value. |
| `notifications/events/events.publisher.ts:35-47` | **`SocketPublisher.publish` must never throw**: a job that publishes after committing and then fails is retried, the commit happens twice, and for `game.round.schedule` that is a duplicate round — "how a stuck-round backlog builds up one `ctrl-c` at a time". Includes the reason the level is `warn`; §3.2 keeps the level and adds a latch, so **this comment gains a sentence, it does not lose one.** |
| `notifications/events/events.publisher.ts:61-72` | Why the relay origin is this process's own id — what stops a node that also runs a worker fanning out its own frame twice. |
| `infra/queue/queue-drain.service.ts:4-29` | **The drain window**, with the reproduction transcript. `QueueRunner` stops workers in `onShutdown`, which runs after `server.stop()`, so a job coming due in between publishes through a `PubSub` with no server. |
| `infra/queue/queue-drain.service.ts:32-39` | **`AppRef`, not `QueueRunner`** — `QueueModule` binds the runner without exporting it, so a constructor parameter is a boot error. |
| `infra/queue/queue-drain.service.ts:47`, `:50-52` | Why the consumer may be absent; why a drain hook must never throw (`Promise.all`). |
| `app.module.ts:102-104` | **Undecorated with a static factory, and it must not also carry `@Module`** — `resolveRef` concatenates, so declaring both registers every import twice. |
| `app.module.ts:53-54` | Schedules are not armed in a job child: bullmq forks one per burst, so a schedule there fires in two or three processes at once. |
| `app.module.ts:56-57` | One `AIModule` for both graphs, because `GoogleService` paces itself against a per-minute quota and two clients would each think they had the allowance. |
| `app.module.ts:59-60`, `:108-109`, `:117`, `:125-126`, `:132-136` | Why the two graphs differ only in `publisher`; why `CLIENT_DIST` is read from the environment and not injected; why `AccountsModule` follows `DatabaseModule`; why `GameModule` is **last**; why `AuditContextMiddleware` is app-level. |
| `app.module.ts:26`, `:28`, `:33-37`, `:143-148` | What `source` and `logLevel` are for; import order is construction order and shutdown is its reverse; what `JobsModule` deliberately omits. **`:28` is the line Batch 1 acts on — keep it and extend it.** |
| `auth/auth.module.ts:90-95` | The better-auth table mapping is **not** optional despite the docs: the adapter looks for `users`, plural. |
| `auth/auth.module.ts:77-79` | Why the reset link is logged with no queue — **§4.2 edits this comment**, and the surviving half explains the `isProd` branch. |
| `auth/auth.options.ts:99-104` | `satisfies` rather than a return annotation, twice over: an annotation widens `plugins`, and the widened form produces an instance with no `generateOpenAPISchema`. |
| `auth/auth.options.ts:6-10`, `:24`, `:40-41`, `:48-50`, `:58-64`, `:74-89`, `:94-96` | `AUTH_MOUNT` vs `basePath`; one id shape across every table; `bunPassword` is native bcrypt; a half-configured provider is absent; **why anonymous auth is a real user row** (a demo wallet needs a `user_id` to point at) and why `emailDomainName` must be a domain we own; why `openAPI({ disableDefaultReference: true })`. |
| `http.options.ts:15-19` | `AppHttpOptions.for` goes to **both** `HttpFactory.create` and `createTestServer` — a suite that forgets them gets a server with no guards that still boots and still answers. |
| `http.options.ts:22-30` | **`notFound: 'public'`** — a miss must answer 404, not the session guard's 401, and `SessionGuard` otherwise puts a database round trip on every miss. |
| `http.options.ts:40-45`, `:54-67`, `:70-71`, `:82` | Why the relay is always configured; **why the client pair belongs in the array and not in two `app.use()` calls** (a cold page load spent its throttle budget on its own JavaScript), and why `SpaFallback` goes outside `StaticFiles`; why `SessionGuard` precedes the throttler; the probe paths kept out of the request log. |
| `main.ts:56-69`, `:72-74`, `:81-91`, `:126-128`, `:140-142` | Why `credentials: true` in dev too (`origin: '*'` reflects the caller); the CORS wildcard warning's reasoning; why `enableShutdownHooks()` replaced a local `forceExitAfter`; **why the banner prints `/auth/ok` and not the bare mount** (Bun's `/*` needs a segment, so the mount 404'd); why `.catch` rather than top-level `await` (the exit code). |
| `config/env-vars.dto.ts:64-69` | `GAME_WAITING_PHASE_MS` must exceed a tick, or a client can miss the WAITING phase and reads it as a frozen game. |
| `config/env-vars.dto.ts:86-90` | `GAME_STUCK_ROUND_THRESHOLD_MS` inside a normal round length **refunds live bets out from under the players holding them.** |
| `config/env-vars.dto.ts:38-45`, `:47-53` | Why `BETTER_AUTH_SECRET` is required in prod (the dev fallback is a constant in the repository); why `REDIS_URL` is required with a Redis session store. |
| `config/dto/game-vars.dto.ts:19-22`, `:47-53`, `:64-68` | `GAME_MULTIPLIER_DIVISOR` changes the house edge and is not cosmetic; bots are off by default and cosmetic only; why bot chat chance is under half. |
| `config/dto/service-vars.dto.ts:18-21`, `:80-82` | Why `logLevels` is a literal tuple; why an empty environment variable normalises to `undefined`. |
| `config/dto/redis-vars.dto.ts:41` | `WORKER_MODE=separate` and `src/worker.ts` are gone; isolation is per handler. |
| `game/schema/game-bet.schema.ts` (the `_x100` notes) | **Multipliers are integer hundredths in storage too.** The payout arithmetic depends on it. |
| `infra/schedule/schedule.module.ts:13-20` | **`global: true` is the reason this wrapper exists** — `ScheduleModule.forRootAsync` exports `ScheduleRegistry` but is not global, so a second `forRootAsync()` call means two registries and two copies of every schedule. |
| `openapi.spec.ts:149-155` | The probes are `@ApiHidden()` upstream and their absence from the document is **asserted on purpose**. |
| `libs/contracts/src/chat.ts:44-50` | The `username` / `senderName` drift that crashed the chat panel — the fourth of the four historical bugs, and the reason the lib exists. Workstream 01 owns this file; do not edit it from here. |
| `infra/db/tx.ts` (whole file) | The single cast that makes `Repository.over(handle)` work inside a transaction. 24 comment lines over 10 code lines, and it is the file that explains the app's atomicity story. |
| `infra/redis/guards/throttle.guard.ts:16-33`, `:66`, `:78-88` | Why the throttler counts per user; why an unreachable counter means **allow**; the `#warned` latch. **This is the L7 reference implementation** — every latch added by this workstream points here. |
| `notifications/handlers/notification.jobs.ts:63-72` | The reset goes on the queue because inline it would hold the response open, and a failing provider would turn "we sent you an email" into a **500 telling an attacker the address exists**. |
| `notifications/handlers/notification.jobs.ts:91-96` | The invite link carries the code, so **the job payload is a credential in a queue** — which is why the queue is the app's own Redis. Directly relevant to §4.3. |
| `notifications/handlers/notification.jobs.ts:48-49` | The two topics, and why a browser seeing the frame proves it crossed processes. |
| `notifications/services/email.service.ts:66-67` | Why the body is **not** logged on the success path. **Keep, and extend it to the unconfigured path** — §4.1 is this comment's rule finally being applied. |
| `files/handlers/media.jobs.ts:63-75` | Why a missing source is `UnrecoverableError`: the default `attempts` describes a slow disk, and retrying logged the same failure **three times, twice each** because a sandboxed handler reports in child and parent. This workstream's §3.2 verdict depends on it. |
| `files/handlers/media.jobs.ts:88-90` | `#isMissing` matches **by `name`, not `instanceof`**, and that is not a shortcut. |
| `files/services/files.service.ts:103-106`, `:153`, `:130-133` | Why the thumbnail is enqueued and not awaited; why the storage key is opaque and never the client's path; why `presign` on local storage is a 501. |
| `invites/services/invites.service.ts:92-98` | **The email comes off the invite, never off the request** — otherwise anyone holding a code creates an account for any address. |
| `invites/services/invites.service.ts:156-166` | Why `expireStale` moved off the `list()` read path (it took SQLite's single writer lock on a read), why it is bookkeeping and not enforcement, and why `@Cron` beats `@Interval`. |
| `invites/services/invites.service.ts:171-177` | Why the invite email is on the queue. |
| `chat/services/chat.service.ts:24-43` | Chat scrollback is a capped Redis list and **the key is deliberately unchanged** so a deploy does not empty every lobby. |
| `chat/services/chat.service.ts:72-77` | `ltrim(-MAX, -1)` keeps the last MAX, which is what `rpush` appends to; the line is already broadcast, so a failed write costs scrollback and not the message. |
| `game/services/player-chat.service.ts:14-37` | Why a room id is a hash of two sorted user ids (create and join are the same operation), and why membership is re-checked against Redis. |
| `game/services/wallet.service.ts:24-27` | **Only the second paragraph.** "Every mutation here is synchronous and every one writes a ledger row beside it" — the sync path is what lets `GameBetService` wrap a debit and an insert in one uninterruptible transaction, and the ledger is what makes a disputed balance replayable. The `## What left with the billing module` paragraph above it (`:15-23`) is Stripe archaeology and goes to §7, **except** the one fact that `WalletTransactionType.DEPOSIT` survives in the enum because old ledger rows carry it — that keeps one line. |
| `game/schema/game-round.schema.ts:17-24` | **Only the second half.** Why an integer count of hundredths rather than `real`, and that `toMultiplier()` is the only place that divides. `:11-16` (the `decimal(10,2)`/TypeORM/float64 narration) is archaeology and goes to §7 as one line. |
| `core/middlewares/audit-context.middleware.ts:7-26` | Why it is app-level and what a scoped version would stamp instead. |
| `infra/queue/queue-unavailable.middleware.ts:10-27` | Why a route degrades to 503 rather than 500 with no broker. |
| `infra/schedule/schedule.module.ts` (the `global: true` note) | `ScheduleRegistry` has two injectors; a second `forRootAsync()` means two registries and two copies of every schedule. |
| `constants.ts:14-19`, `:26-30` | The health paths are **restated rather than imported** because they are literals in the package's decorators; `WS_PATH` and the auth mount are decided at class-definition time. |
| `openapi.spec.ts` (the probe-omission assertions) | The probes are `@ApiHidden()` upstream and their absence from the document is asserted **on purpose**. |
| `apps/fe/src/middleware/authMiddleware.ts:7-26` | **The JWT-parse bug that logged every signed-in user out within a minute**, forever, with the reason buried in a `console.error`. Also the reason the replacement asks the server instead of guessing. |
| `apps/fe/src/middleware/authMiddleware.ts:73-76` | A network failure is **not** a signed-out user: clearing there logs someone out because their wifi blinked. |
| `apps/fe/src/store/authStore.ts:33-53` | `user` is a dependency of `useWebSocket`'s effect, so a new object identity reconnects the socket. |
| `apps/fe/src/systems/network/socket.ts:1-23` | The socket.io-shaped shim over `{ event, data }` — why the React components never changed. |
| `apps/fe/src/systems/network/socket.ts:88-96` | Why frames emitted before `open` are queued. |
| `libs/stage/src/stage.ts:45-56` | **PIXI's `init()` never settles when the browser has no usable GPU** — reproduced under ANGLE/SwiftShader, logging nothing. The timeout exists so the failure reaches the caller's `catch`. This is why `CrashChart.tsx:108` keeps its `console.error`. |
| `libs/stage/src/types.ts:22-48`, `:62-75`, `:82-90` | Why `elapsed`/`multiplier` are interpolated while `points` are not (the curve snapped sideways every tick); why `curveAt` exists (integer hundredths draw as visible stairs); **why the stage owns its own canvas** (StrictMode pointed two `Application`s at one WebGL context); why cash-outs are taken rather than sampled. |
**Rule of thumb for anything not on this list:** if the comment names a symptom
("shipped", "a test caught it", "only a browser caught it", "would break", "must not"),
treat it as protected and leave it. If it narrates a framework the repo no longer uses,
cut the narration and keep the rule.

**And the trap inside the rule of thumb:** several blocks are archaeology *wrapping* a
protected invariant. `wallet.service.ts:12-28` and `game-round.schema.ts:8-24` are both
one comment where the first paragraph is Stripe/TypeORM history and the second is a
correctness rule. Deleting the block deletes the rule. **Every §7 cut inside a block
that also appears in §6 is a paragraph-level edit, never a block deletion** — and the
reviewer's job on batches 9b–9e is to check exactly that.

---

## 7. Comment kill list

Per file, worst first by absolute comment lines. The generic rules in §1.2 apply
everywhere; this table names what is specifically wrong in each file so the
implementation does not have to re-derive it.

| file | comment / code | what goes | what stays |
| --- | --- | --- | --- |
| `game/game.gateway.ts` | 149 / 438 | The class essay's `## Why one gateway and not two` section (`:63-74`) — CLAUDE.md's WebSockets section says the same thing better (C6). Collapse to two lines plus a pointer. Drop the `EventsGateway`/socket.io narration. | Everything in §6 — which is most of this file. Net: ~25 lines. |
| `libs/stage/src/stage.ts` | 120 / 230 | Two archaeology mentions; the `##` headings. | The SwiftShader block (`:45-56`) and the render-loop reasoning. |
| `apps/fe/src/systems/auth/auth-api.ts` | 97 / 160 | The 25-line file-header essay (`:4-28`) and two `##` headings — this is C5 in its purest form. Move the flow description to `docs/` or shorten to five lines. | The cookie-first / `SameSite=Lax` rules; anything naming a symptom. |
| `game/engine/crash-engine.service.ts` | 84 / 247 | `## The tick emitter is gone` (`:62-68`) — pure archaeology about two NestJS callbacks that no longer exist. `## One process, and why` (`:51-57`) restates CLAUDE.md. | `:116-122`, `:175-177`, `:196-202`, `:257-261`, `:335-346`, `:84`, `:316-317` (§6). |
| `openapi.spec.ts` | 82 / 174 | Prose explaining what each assertion asserts (C1). | The probe-omission rationale and the two "asserts the omission" notes. |
| `game/services/game-round.service.ts` | 74 / 198 | Restatements of the four-step fairness ordering that CLAUDE.md already holds — keep **one** pointer at `createNextRound`. | `:44-53`, `:137-142`, `:188-194`, `:226-228` (§6). |
| `game/bots/game-bots.service.ts` | 72 / 158 | The `##` heading; the last paragraph of the class doc about read-path inconsistency can shrink to one sentence. | `:67-87`, `:118-126`, `:21-27` (§6). |
| `infra/queue/queues.spec.ts` | 71 / 149 | Test prose describing the arrange/act/assert. | Why this spec alone sets `QUEUE_CONSUME: 'true'` and its own `QUEUE_PREFIX`. |
| `auth/auth.module.ts` | 70 / 82 | **46% comment.** The forRootAsync narration and the better-auth-vs-passport comparisons. | `:90-95` (the `users` plural trap), `:77-79` (edited per §4.2). |
| `game/services/game-bet.service.ts` | 65 / 215 | The `##` heading; the `pg_try_advisory_xact_lock` history sentence — keep the three replacements, drop the Postgres framing (CLAUDE.md has it). | `:32-60`, `:225-228`, `:250-253` (§6). |
| `libs/stage/src/{scale,layers/*}.ts` | 64/107, 53/90, … | Three archaeology mentions in `scale.test.ts`; `##` headings in `rocket.ts` and `grid.ts`. | The measured-behaviour notes (they name symptoms). |
| `libs/stage/src/types.ts` | 60 / 28 | **68% comment, and none of it should go.** No action beyond the file-header essay's first paragraph. | All of §6's entries. |
| `apps/fe/src/systems/network/{useWebSocket,socket,useGameSocket}.ts` | 59/192, 58/162, 56/182 | Ten archaeology mentions across the three; two `##` headings in `socket.ts`. | `socket.ts:1-23` and `:88-96`; the reconnect/backoff reasoning. |
| `auth/auth.options.ts` | 57 / 46 | **55% comment**, and almost all of it is protected. Only the passport comparison in `:58-64` shortens. | Everything else (§6). |
| `game/game.math.ts` | 57 / 46 | **55% comment**, entirely protected. **No action.** | All of it (§6). |
| `apps/fe/src/middleware/authMiddleware.ts` | 55 / 41 | Two `##` headings; five archaeology mentions. Restructure into two doc comments on the two functions (C3), not one 20-line header ×2. | `:7-26` and `:73-76` (§6). |
| `apps/fe/src/store/{authStore,gameStore}.ts` | 53/65, 53/311 | A `##` heading; the store-shape narration. | `:33-53` (the socket-reconnect identity rule). |
| `infra/db/database.module.ts` | 52 / 68 | Nothing. **The 39-line pragma block is the single most valuable comment in the repo.** | All of it (§6). |
| `invites/services/invites.service.ts` | 52 / 130 | The forRoot/module narration. | `:92-98`, `:156-166`, `:171-177` (§6). |
| `main.ts` | 51 / 81 | The `links()` banner's per-key commentary, except the `/auth/ok` note. | `:56-69`, `:81-91`, `:126-128`, `:140-142`, `:70-71` (§6). |
| `app.module.ts` | 47 / 108 | **The named exhibit.** Nothing structural is wrong — but the *import block* carries no comments while the `imports` array carries six, three of which are protected. Audit the three that are not (C1). The `Foundation` class doc's first paragraph restates CLAUDE.md (C6). | `:26`, `:28`, `:53-54`, `:56-57`, `:59-60`, `:102-104`, `:108-109`, `:117`, `:125-126`, `:132-136`, `:143-148` (§6). Realistic yield here is **~8 lines**, not 47 — the exhibit is less guilty than it looks. |
| `notifications/services/email.service.ts` | 34 / 32 | The 32-line class essay (`:11-42`): `## Why the client rather than fetch` is a dunx-choice argument that belongs in CLAUDE.md, and the `axios`/`node-fetch` ban is already there. Cut to ~8 lines. **And the `with no URL configured it logs the message it would have sent` sentence goes with the §4.1 code change.** | `:66-67`, extended (§6). |
| `notifications/handlers/notification.jobs.ts` | — | The class doc's `WorkerFactory.create(WorkerModule)` narration (`:19-27`) — pure archaeology. | `:63-72`, `:91-96`, `:48-49` (§6). |
| `apps/fe/src/components/ui/ChatWindow.tsx` | — | **`// --- SCROLL LOGIC ---` (:52), `// --- KEYBOARD & FOCUS ---` (:70).** C2. | — |
| `apps/fe/src/components/ui/MessageBubble.tsx` | — | **`// --- STYLING CONSTANTS ---` (:37), `// --- MARKDOWN COMPONENTS (The Secret Sauce for formatting) ---` (:42).** C2. | — |
| `apps/fe/src/components/auth/LoginForm.tsx` | — | **`// --- Types ---` (:17), `// --- Config ---` (:40), `// --- Sub-Components ---` (:67), `// --- Main Component ---` (:127).** C2, four of the eight. This file is also the one that most wants splitting, which is what C2 says a banner means. | — |
| every other file | — | Apply C4 (delete the archaeology sentence, keep the rule) and C5 (a `##` heading means the block is too long). 105 archaeology blocks, 37 headings. | Anything on the §6 list. |

Fixed targets for the after-run:

- section-divider banners: **8 → 0**
- `##` headings in doc comments: **37 → 0** (each block either shrinks below needing them or moves to `docs/`)
- comment blocks ≥ 15 lines: **51 → ≤ 20**, and every survivor is on the §6 list
- overall ratio: **22.4% → ~14%**
- `apps/be/src`: **26.7% → ~16%**
- files above 45% ratio with ≥ 40 code lines: **5 → 2** (`game.math.ts` and `auth.options.ts` stay high, and correctly so)

---

## 8. Implementation plan

Nine batches, each one reviewable commit. Batch 0 goes in on its own, immediately,
regardless of where the rest of the sweep stands.

### Batch 0 — secrets out of the log stream

*Files:* `notifications/services/email.service.ts`, `auth/auth.module.ts`,
`invites/services/invites.service.ts`.

1. `email.service.ts` — drop `body` from the unconfigured-path log; move the
   "no `EMAIL_WEBHOOK_URL`" fact to one `warn` in a new `onInit`; log nothing per email
   there. Extend the `:66-67` comment to say the rule now covers both paths.
2. `auth.module.ts:80` — include `url` only when `!config.get('isProd')`; keep a
   one-line comment saying why the branch exists.
3. `invites.service.ts:191` — drop `url` unconditionally.
4. Tests: assert `EmailService.send` emits no `body` field; assert the invite warning
   carries no `url`. `bun run test` must print **0** lines matching `'"body":"Hello'`.

*Reviewable because:* three files, one subject, and the diff is auditable line by line.

### Batch 1 — the fork inherits the test log level

*Files:* `jobs.processor.ts`, `jobs.processor.spec.ts`, `app.module.ts:28` (comment).

`jobs.processor.ts:38` gains a `logLevel` when `NODE_ENV === 'test'` (verified: `bun
test` sets it, and a bullmq fork inherits the environment). Extend the existing
`:22-37` comment with one sentence — same trap, same file, same reason a literal cannot
cross a fork.

*Before:* 32 JSON lines from `bun run test`. *After:* **≤ 1** (the
`error-mapper.test.ts` fixture, which is the subject of its own test).

This is the batch that makes every later batch's before/after legible, so it goes second.

### Batch 2 — the latch helper

*Files:* one new helper next to `infra/redis/guards/throttle.guard.ts`, plus the seven
call sites in §3.5.

A tiny "log once per outage, reset on success" wrapper, modelled on
`ThrottleGuard.#warned`, applied to: `game.gateway.ts:131`,
`events.publisher.ts:52`, `game.jobs.ts:168`, `crash-engine.service.ts:355`,
`files.service.ts:169`, `slack.service.ts:81`, `chat.service.ts:57,84`. Each keeps its
level; what changes is that one incident stops producing one line per attempt.

Test: drive a failing publisher N times, assert one line. This is the "a bug fix comes
with the test that would have caught it" case for the 10-lines-per-second gateway error.

### Batch 3 — the clock paths

*Files:* `auto-cashout.service.ts:118`, `cache.service.ts:76`,
`game-bots.service.ts:230`, `player-chat.service.ts:165` (delete),
`game.gateway.ts:623` (delete — but only if Batch 8 has landed; otherwise defer).

L3 applied. Four demotions to `verbose` and one deletion. Smallest diff, largest effect
on a running box.

### Batch 4 — the game path

*Files:* `crash-engine.service.ts`, `game-round.service.ts`, `game-bet.service.ts`.

The five per-round `info` lines (§2.2) plus `bet placed`, `bet cashed out`,
`round was already started by another worker`, and the `active bets settled as lost`
deletion. Drop `{ message }` from the malformed-command error.

*Verify:* with Redis up (`docker compose up -d`) and `LOG_LEVEL=info`, watch for two
minutes. **Zero** lines. Then `LOG_LEVEL=debug` and confirm the round is still fully
traceable. Record both in the PR.

### Batch 5 — the three promotes

*Files:* `game-round.service.ts:154-155`, `game.gateway.ts:169-171`,
`game.gateway.ts:320-326`, `apps/fe/src/systems/network/socket.ts:188-192`.

§3.4. Each is a behaviour change, so each gets a test: an unreachable Redis at launch
must produce one `warn` naming the round; a rejected session on upgrade must produce
one `debug` and still yield a spectator.

Separate from Batch 4 because these **add** lines, and mixing additions into a
reduction commit makes the before/after unreadable.

### Batch 6 — everything else at `info`, plus the config

*Files:* `users`, `invites`, `files`, `ai`, `notifications`, `auth/services`, `main.ts`,
`config/dto/service-vars.dto.ts`, `apps/be/.env`, `apps/be/.env.example`.

The remaining L2/L4 demotions and the three L4 deletions in `notification.jobs.ts`.
Then: `LOG_LEVEL` default `debug` → `info`; fix the stale `LOG_FILTER_EVENTS` in
`apps/be/.env`; revisit `LOG_MASK_FIELDS` (drop `key`, add `token`, `url`, `body`).
Fix the templated message at `ai-provider.service.ts:124` (L9).

*Gate:* after this batch,
`grep -rc "logger\.info(" apps/be/src --include='*.ts' | awk -F: '{s+=$2} END{print s}'`
must total **5**, and they must be the five named in §1.1.

### Batch 7 — the frontend

*Files:* `useWebSocket.ts`, `useDominantColor.ts`, `socket.ts`.

Two `import.meta.env.DEV` gates, one deletion, one DEV-only parse warning (Batch 5's
fourth item can land here instead if that reads better). Five call sites.

### Batch 8 — the websocket middleware

Blocked on the dunx-side work in §5. Then, in the app: one field in
`http.options.ts:43`, delete `game.gateway.ts:621-629`, and drop the gateway's `Logger`
if Batch 2 left it unused. **Ships with the `ignoreEvents: ['gameTick']` entry from
day one** — without it the middleware is the new worst offender in §3.5.

### Batch 9 — comments

Split by area so each commit stays reviewable, and **§6 is re-read before each one**:

- **9a** — the 8 section-divider banners (§7, three `apps/fe` files). Mechanical, zero risk, does the thing CLAUDE.md explicitly asks for. Gate: the banner grep returns nothing.
- **9b** — `apps/be/src/{game,engine,handlers}`: archaeology sentences and `##` headings. The largest and most dangerous commit; §6 covers most of `game.gateway.ts`, `game.math.ts` and `crash-engine.service.ts`.
- **9c** — `apps/be/src/{auth,users,invites,files,notifications,ai,chat}`.
- **9d** — `apps/be/src/{config,core,infra}` — **`database.module.ts`, `tx.ts`, `throttle.guard.ts` and `queue-drain.service.ts` are almost entirely protected; expect a near-empty diff there and do not force one.**
- **9e** — `apps/fe/src` and `libs`.
- **9f** — the CLAUDE.md / `docs/` side: anything C4 or C6 removed a *reason* for gets a home. If a paragraph was worth writing in a source file it is worth keeping somewhere; this batch is what makes 9b–9e a move rather than a loss.

Run the §2 commands after 9f and paste the table.

### Ordering constraints

- **Batch 0 does not wait for anything.**
- Batch 1 before 2–7, or the before/after numbers are noise.
- Batch 8 after Batch 2 (the gateway's `Logger` usage decides whether the field goes).
- Batch 9 after 0–8: the code batches move and delete log statements, and every moved statement is a comment that may need to move with it.
- All of 05 after workstreams 01–04 and 06, as agreed. **Except Batch 0**, which is a live credential in a log file and does not queue behind a refactor.

### Definition of done

```
logger call sites, total                      74  →  ~71
logger call sites at info                     27  →   5
logger call sites at verbose                   0  →   3
log statements deleted outright                    7
JSON lines from `bun run test`                32  →  ≤1
app log lines per round at LOG_LEVEL=info      5  →   0
log statements carrying a token or a body      3  →   0
silent catches that weaken a guarantee         3  →   0
section-divider banners                        8  →   0
`##` headings inside doc comments             37  →   0
comment blocks ≥ 15 lines                     51  →  ≤20
comment:code ratio, repo                   22.4%  →  ~14%
comment:code ratio, apps/be/src            26.7%  →  ~16%
comments deleted from the §6 protected list          0
```
