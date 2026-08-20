# @firecracker/contracts

The wire between `apps/be` and `apps/fe`.

## Why it exists

Both sides used to declare the socket payloads separately - the server in
`game.events.ts`, the client in hand-written interfaces beside its handlers. They
drifted, four times, and every drift shipped:

| Symptom                                               | Cause                                                 |
| ----------------------------------------------------- | ----------------------------------------------------- |
| One bet rendered as two players                       | `betAck` keyed on username; the server sent an id     |
| Auto-cashout invisible until the round ended          | `betCashedOut` carried no `userId`                    |
| The chat panel crashed on render                      | history sent `username`; the client read `senderName` |
| Players sharing a display name collapsed into one row | `betPlaced` carried no `userId`                       |

Each was found by a person looking at a screen. With one declaration they are
compile errors instead.

## What belongs here

**Yes:** socket event names in both directions, the payload each carries, the
`ServerPayloads` / `ClientPayloads` maps that pair a name with its payload, the
HTTP response shapes the client reads, and the enums both sides read (round and bet
status, roles, transaction types).

**No:** queue names, job names and job payloads. Those are how the server talks to
itself, and a browser has no business knowing them - they stay in
`apps/be/src/game/game.events.ts`, which re-exports this package for the wire half.
A `notification` frame therefore carries a `NotificationKind`, not the name of the
job that produced it.

Also no: the zod schemas the routes validate against, and the parsers the gateway
runs on an inbound frame. Agreeing on a shape and checking a frame are separate
decisions - see below.

## The maps have to be complete

`src/index.test.ts` asserts that every event name has a payload and every payload
has an event name. That is not tidiness: `chatAck` did not exist, so the gateway
answered a chat message under the name the client had just sent, and no client
listened for it. A name with no payload fails `bun test`; a payload with no name
fails `bun run typecheck`.

The same file's principle covers the HTTP half from the other side:
`apps/be/src/game/dto/game.dto.test.ts` asserts the zod schema and the interface
here have the same keys and are assignable both ways. That is what makes two
declarations of one response safe.

## Type-only, on purpose

Payloads are `interface`s and erase at build time, so the client pays nothing for
them. The event _names_ are real frozen objects, because a name is worth importing
rather than retyping as a string literal at each call site.

There are deliberately **no zod schemas here**. Sharing them would put zod in the
browser bundle, and validating frames the server just sent is a separate decision
from agreeing on their shape.
