# 01 — Stop inline contracts

## State of play

The **game** half of the socket is already done properly: `libs/contracts/src/game.ts`
declares every `gameXxx` event name, its payload, and the `GamePayloads` map, and
every game publish goes through the typed `GameEvents.publish` wrapper
(`apps/be/src/game/game.events.ts:88`), so a missing field is a compile error on
both sides. `apps/fe/src/systems/network/useGameSocket.ts` imports all ten payload
types and nothing restates them. That is the pattern that works, and it needs no
further work.

Everything **else** that crosses the boundary is still declared inline, and it is
declared inline in the exact shape the four historical bugs had. Three gaps:

1. **`libs/contracts/src/chat.ts` has payload interfaces but no payload _map_.**
   There is no `SocketPayloads` / `PlayerChatPayloads` analogous to `GamePayloads`,
   so there is no typed publish helper for `connected`, `message`, `chatHistory`,
   `userCount`, `notification` or the four `playerChat*` events. All eleven of
   those go through raw `EventsPublisher.publish(topic, event, unknown)` or a bare
   `socket.send(JSON.stringify(...))` — the untyped hole CLAUDE.md names. Three of
   the payload types that _do_ exist (`ConnectedPayload`, `PlayerChatSystemPayload`,
   and `ChatLine` at the gateway) are never imported by the code that builds them.
2. **Client→server payloads are not in the lib at all.** The _names_ are shared
   (`GAME_CLIENT_EVENTS`, `SOCKET_CLIENT_EVENTS`), but the bodies are object
   literals in FE components and hand-written parsers in `game.messages.ts`. Two
   declarations, nothing comparing them — the precondition for all four past bugs.
3. **HTTP response shapes are server-only zod, so the FE hand-writes them.** That
   has already drifted: `PlayerHistory.tsx` types a field the server has never sent.

Raw `publish` call sites remaining: **11** (gateway 4, player-chat 2, bots 1,
notification jobs 4). Untyped `socket.send` frames: **4**. Inline cross-boundary
literals: **~27**, tabled below.

## Findings

| inline declaration                                                                                                                             | file:line                                                                                                                                                     | target contracts module                                                                                                                     | FE reading a different shape today        | risk     |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------- |
| `interface BetEntry` — the `/api/game/my-bets` row, incl. a `crashPoint` the server never sends                                                | `apps/fe/src/components/game/PlayerHistory.tsx:9-16`                                                                                                          | new `libs/contracts/src/http.ts` → `GameBetView`                                                                                            | **YES — live bug #1**                     | **high** |
| `status: 'active' \| 'cashed_out' \| 'lost' \| 'refunded'` restated by hand                                                                    | `apps/fe/src/components/game/PlayerHistory.tsx:12`                                                                                                            | `GameBetStatus` (already in `enums.ts:28`)                                                                                                  | yes (duplicate declaration)               | med      |
| `cashedOutAt?: number` / `payoutCents?: number` where the server sends `number \| null`                                                        | `apps/fe/src/components/game/PlayerHistory.tsx:13-14`                                                                                                         | `GameBetView`                                                                                                                               | yes (type lie, survives at runtime)       | low      |
| `globalChat` returns `{ delivered: number } \| { error: string }`, replied under the **inbound** name `chatMessage`                            | `apps/be/src/game/game.gateway.ts:592,594,598,618`                                                                                                            | `chat.ts` → new `CHAT_ACK` event + `ChatAckPayload`                                                                                         | **YES — live bug #2, nothing listens**    | med      |
| `@OnMessage('chatMessage')` as a bare string, not `SOCKET_CLIENT_EVENTS.CHAT_MESSAGE`                                                          | `apps/be/src/game/game.gateway.ts:588`                                                                                                                        | import the existing constant (`chat.ts:18`)                                                                                                 | no (matches by luck)                      | med      |
| `connected` payload built as an inline literal; `ConnectedPayload` exists and is unused server-side                                            | `apps/be/src/game/game.gateway.ts:224-236`                                                                                                                    | `chat.ts:34` — just import it                                                                                                               | no                                        | med      |
| `walletUpdated` sent via `socket.send` with an untyped literal                                                                                 | `apps/be/src/game/game.gateway.ts:240-245`                                                                                                                    | `WalletUpdatedPayload` (`game.ts:140`)                                                                                                      | no                                        | med      |
| `chatHistory` sent via `socket.send`, no payload type on the frame                                                                             | `apps/be/src/game/game.gateway.ts:213-218`                                                                                                                    | `SocketPayloads['chatHistory'] = readonly ChatLine[]`                                                                                       | no                                        | med      |
| `gameRoundState` sent via `socket.send` (typed at the source, untyped at the send)                                                             | `apps/be/src/game/game.gateway.ts:203-208`                                                                                                                    | `GamePayloads` via a typed `#send`                                                                                                          | no                                        | low      |
| `playerChatSystemMessage` inline literal with `type: 'leave'`                                                                                  | `apps/be/src/game/game.gateway.ts:531-536`                                                                                                                    | `PlayerChatSystemPayload` (`chat.ts:78`)                                                                                                    | no                                        | med      |
| raw `events.publish` → `playerChatRoomCreated`                                                                                                 | `apps/be/src/game/game.gateway.ts:549-553`                                                                                                                    | typed helper over `PlayerChatPayloads`                                                                                                      | no                                        | med      |
| raw `events.publish` → `message` (chat line)                                                                                                   | `apps/be/src/game/game.gateway.ts:614`                                                                                                                        | `ChatLine` + typed helper                                                                                                                   | no                                        | med      |
| raw `events.publish` → `userCount`, a bare `number`                                                                                            | `apps/be/src/game/game.gateway.ts:638-642`                                                                                                                    | `SocketPayloads['userCount'] = number`                                                                                                      | no                                        | low      |
| raw `events.publish` → `playerChatMessage`, inline literal                                                                                     | `apps/be/src/game/services/player-chat.service.ts:139-149`                                                                                                    | typed helper                                                                                                                                | no                                        | med      |
| raw `events.publish` → `playerChatSystemMessage`, inline literal                                                                               | `apps/be/src/game/services/player-chat.service.ts:155-164`                                                                                                    | `PlayerChatSystemPayload` + typed helper                                                                                                    | no                                        | med      |
| raw `events.publish` → `message`, inline bot chat line                                                                                         | `apps/be/src/game/bots/game-bots.service.ts:220-226`                                                                                                          | `ChatLine` + typed helper                                                                                                                   | no                                        | med      |
| raw `events.publish` → `notification` ×4, inline `{ event, payload }`                                                                          | `apps/be/src/notifications/handlers/notification.jobs.ts:52,56,118,141`                                                                                       | `chat.ts` → `NotificationPayload`                                                                                                           | no FE handler exists at all (live bug #3) | med      |
| `interface Notification` declared and never used                                                                                               | `apps/be/src/notifications/events/events.ts:91-94`                                                                                                            | move to `chat.ts` as `NotificationPayload`                                                                                                  | n/a                                       | low      |
| `placeBet` body — literal on the FE, `ParsedBet` on the BE                                                                                     | `apps/fe/src/components/game/BetPanel.tsx:296-300` / `apps/be/src/game/game.messages.ts:90-109`                                                               | `game.ts` → `PlaceBetMessage` + `GameClientPayloads`                                                                                        | yes (two declarations)                    | med      |
| `joinPlayerChat` body — literal ×2 on the FE, `JoinChatRequest` on the BE                                                                      | `apps/fe/src/components/game/PlayerList.tsx:81-84`, `apps/fe/src/systems/network/useWebSocket.ts:142-145` / `apps/be/src/game/game.messages.ts:63-68,130-139` | `chat.ts` → `JoinPlayerChatMessage`                                                                                                         | yes                                       | med      |
| `sendPlayerChatMessage` body — literal on the FE, `PlayerMessageRequest` on the BE                                                             | `apps/fe/src/components/ui/PlayerChatDialogue.tsx:26-29` / `apps/be/src/game/game.messages.ts:70-73`                                                          | `chat.ts` → `SendPlayerChatMessage`                                                                                                         | yes                                       | low      |
| `chatMessage` body `{ message }` ×3 on the FE; BE accepts a bare string _or_ `{ message }`                                                     | `apps/fe/src/components/ui/GlobalChat.tsx:192`, `apps/fe/src/components/game/Game.tsx:50,248` / `apps/be/src/game/game.messages.ts:118-122`                   | `chat.ts` → `ChatMessageBody`                                                                                                               | yes (BE is laxer than the FE ever sends)  | low      |
| `leavePlayerChat` body `{ roomId }`                                                                                                            | `apps/fe/src/components/ui/PlayerChatDialogue.tsx:34` / `apps/be/src/game/game.messages.ts:153-155`                                                           | `chat.ts` → `LeavePlayerChatMessage`                                                                                                        | yes                                       | low      |
| `ROUND_STATUSES` / `BET_STATUSES` / `TRANSACTION_TYPES` re-declared locally although contracts exports all three                               | `apps/be/src/game/dto/game.dto.ts:8-28`                                                                                                                       | import from `@firecracker/contracts` (or the schema re-exports at `game-round.schema.ts:6`, `game-bet.schema.ts:18`, `wallet.schema.ts:17`) | no                                        | low      |
| `verify()` returns an inline literal with no return type; the `RoundVerification` zod schema is dead                                           | `apps/be/src/game/game.controller.ts:159-179`, `apps/be/src/game/dto/game.dto.ts:85-100`                                                                      | annotate against the dto (zod **stays** server-side)                                                                                        | no (FE does not call it yet)              | low      |
| `(await res.json()) as { avatars?: string[] }` vs the server's `{ avatars: string[] }`                                                         | `apps/fe/src/components/ui/AvatarPicker.tsx:43` / `apps/be/src/auth/profile.controller.ts:67-69`                                                              | `http.ts` → `TrendingAvatars`                                                                                                               | shape matches, optionality differs        | low      |
| dead duplicate parsers: free `parseBet`/`parseSeed`/`parseChat`/`playerFacing` + `ParsedBet`, shadowed by the identical `GameMessages` statics | `apps/be/src/game/game.messages.ts:3-61`                                                                                                                      | delete (nothing imports them)                                                                                                               | n/a                                       | low      |
| dead duplicate `playerChatTopic` free function vs `GameEvents.playerChatTopic`                                                                 | `apps/be/src/game/game.events.ts:57-58` vs `:84-86`                                                                                                           | delete the free function (no importers)                                                                                                     | n/a                                       | low      |
| dead dto exports: `CurrentRound`, `RoundVerification`, `PaginatedRounds`, `PaginatedBets`, `PaginatedTransactions`                             | `apps/be/src/game/dto/game.dto.ts:56,85,125,126,127`                                                                                                          | wire into `@ApiDoc` responses or delete                                                                                                     | n/a                                       | low      |
| CLAUDE.md names the helper `publishGame`; the code has a static-only `GameEvents` class                                                        | `apps/be/src/game/game.events.ts:79-96`                                                                                                                       | rename to a free `publishGame` function so doc and code agree                                                                               | n/a                                       | low      |

## Live drift found

Three. Two are shipped bugs, one is a dead wire.

### 1. `crashPoint` is never sent on `/api/game/my-bets` — every lost bet renders `×0.00x`

- **FE expects it:** `apps/fe/src/components/game/PlayerHistory.tsx:15`
  (`crashPoint?: number`) and renders it at `:197`:
  `` resultLabel = isWon ? … : `×${(bet.crashPoint ?? 0).toFixed(2)}x` `` — plus the
  tooltip at `:100-108`.
- **Server never sends it:** `GameController.#mapBet` builds nine fields and no
  `crashPoint` (`apps/be/src/game/game.controller.ts:49-64`); the response schema
  has no such key (`apps/be/src/game/dto/game.dto.ts:62-75`); the table has no such
  column (`apps/be/src/game/schema/game-bet.schema.ts:36-85`); and
  `listByUser` paginates `gameBets` alone with no join to `gameRounds`
  (`apps/be/src/game/repos/game-bet.repository.ts:158-166`).
- **Effect:** for every `lost` or `refunded` row, "MY BETS" shows `×0.00x` — a
  crash multiplier of zero, which is not a value the game can produce.
- **Fix:** join `gameRounds.crashPointX100` in `listByUser` (or map it in
  `#mapBet` from a joined row), add `crashPoint: z.number().optional()` to the
  `GameBet` schema, and have the FE import the shape instead of declaring it.
  Regression test: a `spec` asserting `crashPoint` is present on a settled lost bet
  and absent while the round is still running (same rule as `#mapRound`).

### 2. The `chatMessage` reply is emitted under an inbound event name, so no client can hear it

- `apps/be/src/game/game.gateway.ts:588-618` — `globalChat` **returns**
  `{ error: 'Login required to chat' }` / `{ error: 'a chat message is a string of
1 to 1000 characters' }` / `{ delivered: 1 }`.
- dunx replies to `@OnMessage('x')` by sending the return value back under `x` —
  stated in this very file at `:249-261`, which is why every other handler calls
  `#reply` with a distinct ack name instead of returning.
- So the frame goes out as `{"event":"chatMessage",…}`, and
  `apps/fe/src/systems/network/useWebSocket.ts` registers **no** `chatMessage`
  listener (only `CONNECTED`, `CHAT_HISTORY`, `MESSAGE`, `USER_COUNT` and the four
  `PLAYER_CHAT_EVENTS`). Both rejections are silently dropped: an anonymous user
  typing into the lobby, or anyone pasting over 1000 characters, sees the input
  clear and nothing happen.
- It also violates the invariant `libs/contracts/src/index.test.ts:40-45` asserts
  ("nothing is both an inbound and an outbound name") — the test passes because it
  only inspects the name _tables_, and this name never made it into one.
- **Fix:** add `CHAT_ACK: 'chatAck'` to `SOCKET_EVENTS` with a `ChatAckPayload`,
  `#reply` it like `betAck`, return `void`, and handle it on the FE. Regression
  test: assert an anonymous `chatMessage` produces a frame whose `event` is not
  `chatMessage`.

### 3. `notification` is published to two topics and no client listens

`apps/be/src/notifications/handlers/notification.jobs.ts:52,56,118,141` publish
`{ event, payload }` on `SOCKET_EVENTS.NOTIFICATION` to `user_<id>` and `admins`.
`SOCKET_EVENTS.NOTIFICATION` is declared in `libs/contracts/src/chat.ts:9`, the
`Notification` interface exists at `apps/be/src/notifications/events/events.ts:91`
and is imported by nothing, and no FE file references the event. The four payloads
are also mutually inconsistent (`{userId,email,name}`, `{userId,email}`,
`{email,role}`, `{userId,reason}`), which is exactly what an unchecked
`Record<string, unknown>` permits. Either a missing FE feature or a dead wire —
type it before deciding, so the decision is visible.

### Compared and clean

Field-by-field, server publish vs client read, for every other event:
`gameRoundState`, `gamePhaseChange`, `gameTick`, `gameCrashed`, `betPlaced`,
`betCashedOut`, `betAck`, `cashOutAck`, `walletUpdated`, `connected`, `message`,
`chatHistory`, `userCount`, `playerChatRoomCreated`, `playerChatRoomJoined`,
`playerChatMessage`, `playerChatSystemMessage` — **no mismatches**. The shared
`GamePayloads` map and the shared `ChatLine` / `PlayerChat*` interfaces are doing
their job; the fields the FE ignores (`seedHash`, `nonce`, `seed`, `clientSeed`,
`algorithm`) are ignored deliberately, since verification goes over HTTP.

One observation, not drift: `submitClientSeed` / `seedAck` are implemented on the
server (`game.gateway.ts:460-502`) and declared in contracts, and **no FE code
emits or listens for either** — every player's seed is auto-generated at
`game.gateway.ts:320-326`. Out of scope here; flag it to whoever owns the FE.

## Implementation plan

Ordered so each step compiles on its own. Steps 1-2 are the shipped bugs; do them
first and independently, because they are the ones a user can see.

1. **Fix bug #1 — send `crashPoint` on a settled bet.**
   Edit `apps/be/src/game/repos/game-bet.repository.ts` (join `gameRounds` in
   `listByUser`, mirroring the existing `findByRoundWithPlayers` join),
   `apps/be/src/game/dto/game.dto.ts` (add `crashPoint: z.number().optional()` to
   `GameBet`), `apps/be/src/game/game.controller.ts` (`#mapBet` attaches it only
   when the round has crashed, the same conditional `#mapRound` uses). Add the
   assertion to `apps/be/src/game/game.spec.ts`.
2. **Fix bug #2 — give `chatMessage` a real ack.**
   Edit `libs/contracts/src/chat.ts` (add `CHAT_ACK: 'chatAck'` to `SOCKET_EVENTS`
   and a `ChatAckPayload { delivered?: number; error?: string }`),
   `libs/contracts/src/index.test.ts` (extend the pinned-names assertion),
   `apps/be/src/game/game.gateway.ts` (`globalChat` returns `void` and `#reply`s
   `CHAT_ACK`; also replace the `'chatMessage'` string literal at `:588` with
   `SOCKET_CLIENT_EVENTS.CHAT_MESSAGE`), and
   `apps/fe/src/systems/network/useWebSocket.ts` (listen for it, surface the error
   through `useNotify`; remember to `off` it in the cleanup at `:238-247`).
3. **Add the missing payload maps and one typed publish helper per family.**
   Edit `libs/contracts/src/chat.ts`: add `NotificationPayload` (moved from
   `apps/be/src/notifications/events/events.ts:91-94`), a `SocketPayloads` map
   covering `connected`/`notification`/`message`/`chatHistory`/`userCount`/`chatAck`,
   and a `PlayerChatPayloads` map covering the four `PLAYER_CHAT_EVENTS`. No new
   file needed; `index.ts` already re-exports `chat.ts`.
4. **Rename the game helper and add the two new ones.**
   Edit `apps/be/src/game/game.events.ts`: replace the static-only `GameEvents`
   class with free functions `publishGame` (the name CLAUDE.md already uses),
   `publishSocket` and `publishPlayerChat`, each generic over its map exactly as
   `GameEvents.publish` is today. Delete the duplicate free `playerChatTopic` at
   `:57-58`, keeping one exported function. Then update the eight existing
   `GameEvents.publish` call sites: `game.gateway.ts:339,345,433,439`,
   `handlers/game.jobs.ts:57,105,137`, `services/auto-cashout.service.ts:91,100`,
   `services/game-watchdog.service.ts:78`, `bots/game-bots.service.ts:177,245`,
   `engine/crash-engine.service.ts:329`, and the two `GameEvents.playerChatTopic`
   uses in `services/player-chat.service.ts:140,156` plus
   `game.gateway.ts:542,583`.
5. **Close the eleven raw `publish` holes.**
   Edit `apps/be/src/game/game.gateway.ts` (`:549` → `publishPlayerChat`, `:614` →
   `publishSocket` with a `ChatLine`-typed `line` at `:604-612`, `:638` →
   `publishSocket`), `apps/be/src/game/services/player-chat.service.ts`
   (`:139`, `:155` → `publishPlayerChat`, annotating the literals
   `PlayerChatMessagePayload` / `PlayerChatSystemPayload`),
   `apps/be/src/game/bots/game-bots.service.ts` (`:226` → `publishSocket`, `line`
   annotated `ChatLine`), and
   `apps/be/src/notifications/handlers/notification.jobs.ts` (`:52,56,118,141` →
   `publishSocket` with `NotificationPayload`). After this step, no call site of
   `EventsPublisher.publish` remains outside the three helpers and the two
   publisher implementations — grep for `\.publish(` and confirm only queue
   publishes (`JobPublisher`) and `redis.publish` are left.
6. **Type the four `socket.send` frames.**
   Edit `apps/be/src/game/game.gateway.ts`: give the class one private
   `#send<E>(socket, event, data)` generic over the merged payload maps (or reuse
   `#reply` with a typed overload), then annotate `:203` (`GameRoundStatePayload`),
   `:213` (`readonly ChatLine[]`), `:224` (`ConnectedPayload` — import it, delete
   the inline `{ payload: { … } }`), `:240` (`WalletUpdatedPayload`) and `:531`
   (`PlayerChatSystemPayload`).
7. **Move the client→server message bodies into the lib.**
   Edit `libs/contracts/src/game.ts` (add `PlaceBetMessage`, `CashOutMessage`,
   `SubmitClientSeedMessage`, and a `GameClientPayloads` map) and
   `libs/contracts/src/chat.ts` (`ChatMessageBody`, `JoinPlayerChatMessage`,
   `SendPlayerChatMessage`, `LeavePlayerChatMessage`, `SocketClientPayloads`).
   Then make `apps/be/src/game/game.messages.ts` return those types from its
   parsers (`ParsedBet` becomes `PlaceBetMessage`, `JoinChatRequest` becomes
   `JoinPlayerChatMessage`, `PlayerMessageRequest` becomes
   `SendPlayerChatMessage` — the parsers stay, only their declared return type is
   imported), and in the same pass **delete the dead free-function block at
   `game.messages.ts:3-61`** (nothing imports it; verified by grep).
8. **Make `emit` typed on the FE so step 7 has teeth.**
   Edit `apps/fe/src/systems/network/socket.ts`: add a typed overload
   `emit<E extends keyof ClientPayloads>(event: E, data: ClientPayloads[E])`
   alongside the existing `emit(event: string, data?: unknown)`. Then the four
   emit sites type-check unchanged: `apps/fe/src/components/game/BetPanel.tsx:296`,
   `apps/fe/src/components/game/PlayerList.tsx:81`,
   `apps/fe/src/components/ui/PlayerChatDialogue.tsx:26,34`,
   `apps/fe/src/components/ui/GlobalChat.tsx:192`,
   `apps/fe/src/components/game/Game.tsx:50,248`,
   `apps/fe/src/systems/network/useWebSocket.ts:142`. Consider the matching
   `on<E extends keyof ServerPayloads>` overload — it is what makes a mistyped
   handler a compile error rather than a convention.
9. **Add the HTTP response shapes the FE actually consumes.**
   Create `libs/contracts/src/http.ts` with `GameBetView` (mirroring the zod
   `GameBet` **as an interface**, including the `crashPoint` from step 1),
   `PageMeta`/`Page<T>` for the keyset envelope the FE reads at
   `PlayerHistory.tsx:177-180`, and `TrendingAvatars`. Export it from
   `libs/contracts/src/index.ts`. Then edit
   `apps/fe/src/components/game/PlayerHistory.tsx` (delete `interface BetEntry` at
   `:9-16`, import `GameBetView`, type the `res.json()`),
   `apps/fe/src/components/ui/AvatarPicker.tsx:43` (replace the inline cast), and
   bind the zod schema to the interface so they cannot part ways: leave
   `export type GameBet = z.infer<typeof GameBet>` as it is and add
   `apps/be/src/game/dto/game.dto.test.ts` asserting assignability both ways
   (`expectTypeOf`-style, or two `const` declarations under `// @ts-expect-error`
   guards if the runner has no type matchers). That test is what stops drift #1
   from recurring; without it step 1 fixes one field and leaves the next one open.
10. **De-duplicate the enum arrays and clear the dead exports.**
    Edit `apps/be/src/game/dto/game.dto.ts`: delete the local `ROUND_STATUSES`,
    `BET_STATUSES` and `TRANSACTION_TYPES` (`:8-28`) and import them from
    `@firecracker/contracts`; annotate `GameController.verify` against
    `RoundVerification` or delete the unused schema; wire `CurrentRound`,
    `PaginatedRounds`, `PaginatedBets` and `PaginatedTransactions` into the
    `@ApiDoc` responses in `game.controller.ts` / `wallet.controller.ts` or remove
    them. Edit `apps/fe/src/components/game/PlayerHistory.tsx` to use
    `GameBetStatus` instead of the hand-written union.
11. **Decide `notification`.** Either add the FE handler (a `useNotify` toast keyed
    on `NotificationPayload.event`) in
    `apps/fe/src/systems/network/useWebSocket.ts`, or delete
    `SOCKET_EVENTS.NOTIFICATION` from `libs/contracts/src/chat.ts` and the four
    publishes in `apps/be/src/notifications/handlers/notification.jobs.ts`. Do not
    leave it typed-but-unread; that is how a payload rots.
12. **Extend the guard test.** Edit `libs/contracts/src/index.test.ts`: assert every
    key of every payload map is a value in the matching name table and vice versa,
    so adding an event name without a payload — or a payload without a name — fails
    in CI. This is the structural version of what the pinned-names test does for
    renames, and it is what would have caught the `chatAck` gap in step 2.

## Do not move — and why

- **Zod schemas.** `apps/be/src/game/dto/game.dto.ts`,
  `apps/be/src/users/dto/user.dto.ts`, `apps/be/src/invites/dto/invite.dto.ts`,
  `apps/be/src/audit/dto/audit-log.dto.ts`, `apps/be/src/files/dto/file.dto.ts`,
  `apps/be/src/ai/dto/ai.dto.ts` and everything in `apps/be/src/config/dto/` stay
  where they are. Sharing them would put zod in the browser bundle, and they carry
  `.meta({ id })` for the OpenAPI document, which is a server concern. Step 9 adds
  a **parallel interface** plus an assignability test; it does not move the schema.
- **`RouteSchemas` objects** (`gameState`, `listRounds`, `oneRound`, `verifyRound`,
  `listMyBets`, `walletQuery`, `listTransactions` — `game.dto.ts:135-151`) are
  dunx route wiring, not a wire shape.
- **Queue and job names.** `GAME_QUEUE`, `GAME_JOBS`, `GameJobName`, `RoundJob`
  (`apps/be/src/game/game.events.ts:41-62`) and `QUEUES`, `JOBS`, `QueueName`,
  `JobName` (`apps/be/src/notifications/events/events.ts:17-32`). A name a browser
  can read is a name somebody will send.
- **Job payloads.** `UserRegisteredJob`, `UserBannedJob`, `UserInvitedJob`,
  `PasswordResetJob`, `FileThumbnailJob` (`events.ts:57-89`). `UserInvitedJob.url`
  is a credential. `NotificationPayload` in step 3 is the _socket_ frame, which is
  a different thing from the job that produced it — keep them separate even though
  they currently share fields.
- **Topic helpers.** `TOPICS`, `Topics.user()` (`events.ts:39-55`) and
  `playerChatTopic` (`game.events.ts`). `GAME_TOPIC` is already in the lib and is
  the exception that proves the rule — it is the one topic a client subscribes to
  by nature of connecting, and it carries no addressing information.
- **Engine internals.** `GAME_ENGINE_CHANNEL` and `EngineCommand`
  (`apps/be/src/game/engine/crash-engine.service.ts`) are one process talking to
  itself over Redis.
- **Socket context.** `SocketPlayer` and `GameSocketContext`
  (`apps/be/src/game/game.gateway.ts:47-58`) hold the caller's `email` and
  `roles`; the frame the client gets is `ConnectedPayload`, which is narrower on
  purpose.
- **Parsers.** `GameMessages`' static methods stay on the server. Step 7 shares the
  _return types_, not the validation — "validating a frame is a separate decision
  from agreeing on its shape."
- **better-auth shapes.** `AuthUser` and `Session`
  (`apps/fe/src/systems/auth/auth-api.ts:34-55`) describe a third-party response
  this repo does not define, and `User` (`apps/fe/src/store/authStore.ts:5-12`) is
  a client-side projection with `isDemo` and a `roles` array the server never sends
  under that name. Leave all three.
- **`libs/stage`.** Rendering-only; not a wire.
