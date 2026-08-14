<div align="center">

# 🚀 Firecracker

**A provably-fair crash game on Bun.**

Bet during the window, watch the rocket climb, cash out before it explodes.
Every round can be independently verified after the fact.

Built on [dunx](https://github.com/petarzarkov/dunx) · SQLite via drizzle · BullMQ · Better Auth · native WebSockets

</div>

---

## Quick start

```bash
bun install
docker compose up -d          # Redis. Without it, rounds never advance.

cp .env.example .env                  # compose settings
cp apps/be/.env.example apps/be/.env  # the app's own settings

bun dev              # API + worker + client
```

Or one at a time:

```bash
bun run dev:be       # API and worker together
bun run dev:web      # the API alone (rounds will not advance)
bun run worker       # the worker alone
bun run dev:fe       # the client on :5173
```

|        |                                            |
| ------ | ------------------------------------------ |
| API    | http://localhost:3999/api                  |
| Docs   | http://localhost:3999/api/docs             |
| Health | http://localhost:3999/api/service/health   |
| Queues | http://localhost:3999/api/queues _(admin)_ |
| Socket | ws://localhost:3999/ws                     |

---

## How a round works

```
     ┌─ web process ──────────────┐        ┌─ worker ─────────────────┐
     │  CrashEngineService        │        │  GameJobs                │
     │  · the clock               │        │  · every DB transition   │
     │  · ticks the multiplier    │        │  · schedule/start/crash  │
     │  · broadcasts to sockets   │        │  · the stuck-round sweep │
     └────────────┬───────────────┘        └────────────┬─────────────┘
                  │       Redis pub/sub + BullMQ        │
                  └─────────────────────────────────────┘
                                    │
                              one SQLite file
```

1. **Waiting** — a round is created. A server seed is drawn and its `SHA256` published as a commitment. The crash point does not exist yet. Players bet and contribute client seeds.
2. **Running** — the window closes, the client seeds are combined, and _only then_ is the crash point drawn. The multiplier climbs `e^(elapsed/10000)`.
3. **Crashed** — everyone still in loses. The server seed, client seed, nonce and algorithm are published.

Drawing the crash point any earlier would mean the players could not have influenced it. Any later would mean the house chose it knowing the bets.

## Verifying a round yourself

```bash
curl localhost:3999/api/game/rounds/<id>/verify
```

```jsonc
{
  "serverSeed": "2948f84a…",
  "serverSeedHash": "d7d3c762…", // published before the round started
  "clientSeed": "firecracker",
  "nonce": 3,
  "algorithm": "pcg64",
  "rngSeed": "2948f84a…:firecracker:3",
  "crashPoint": 1.29,
  "howToVerify": [/* the four steps below */],
}
```

```ts
import { Rng } from '@arkv/rng';

// 1. the commitment held
const h = new Bun.CryptoHasher('sha256');
h.update(serverSeed);
h.digest('hex') === serverSeedHash;

// 2-4. redraw the number
const rng = new Rng(rngSeed, algorithm);
const u = rng.float();
rng.free();

const crashPoint =
  (u < 0.03 ? 100 : Math.max(100, Math.floor(99 / (1 - u)))) / 100;
// → 1.29
```

The distribution: **~3%** instant crash (the house edge), **~50%** below 2x, and `P(crash ≥ x) ≈ 0.99 / x` above that.

---

## Layout

```
apps/be     the dunx API, the worker and the socket gateway
apps/fe     the React + Vite client
```

`apps/be/src/game/` is the application; everything else is scaffolding.

| Path                         | What                                                      |
| ---------------------------- | --------------------------------------------------------- |
| `game/engine/`               | the clock — ticks, crash detection, restart recovery      |
| `game/handlers/game.jobs.ts` | the round lifecycle as four BullMQ jobs                   |
| `game/game.gateway.ts`       | the only WebSocket: game, chat and notifications          |
| `game/game.math.ts`          | the curve, the payout, the crash-point draw               |
| `game/services/`             | rounds, bets, wallets, auto-cashout, the lobby read model |

---

## Notable decisions

**Multipliers are integer hundredths.** `1.07x` is `107`, in the database and in the engine. `Math.floor(bet * multiplier)` against a float loses a cent when the float is `1.9999999999999998`; integer arithmetic cannot.

**Two RNGs, on purpose.** The _server seed_ comes from `crypto.getRandomValues`, because it is published after every round and a non-cryptographic PRNG's state is recoverable from a handful of outputs — a player collecting seeds could otherwise predict every future crash. The _crash point_ is drawn with [`@arkv/rng`](https://www.npmjs.com/package/@arkv/rng), seeded deterministically, which is what makes it reproducible by anyone.

**No advisory lock.** SQLite has none, and none is needed: a synchronous transaction cannot yield, the debit is guarded in SQL (`WHERE balance_cents >= ?`), and a unique index catches the cross-process double bet. A lost race now answers _"you already have an active bet"_ rather than _"please try again"_.

**One socket.** dunx mounts a gateway as a route, so two gateway classes would mean two connections where socket.io gave one. The client keeps its `socket.on(…)` / `socket.emit(…)` code through a small shim over the `{ event, data }` envelope.

**Play without signing up.** "Try Demo" is better-auth's `anonymous()` plugin — a real user row with a funded demo wallet and no credential, because a wallet needs somebody to belong to. Watching needs no account at all: the socket upgrade admits spectators.

**Direct messages are derived, not allocated.** A room id is a hash of the two user ids _sorted_, so both players compute the same one and "create" and "join" are the same call. Membership lives in Redis and is re-checked on every message — the id is a hash of two user ids, not a secret.

**Bots are cosmetic.** `GAME_BOTS_ENABLED=true` populates an empty lobby. `GameBotsService` has no repository, by design — a bot placing real bets would contribute entropy to the crash point, which is the house influencing its own outcome.

---

## Commands

| Command                                 | Does                          |
| --------------------------------------- | ----------------------------- |
| `bun dev`                               | API, worker and client        |
| `bun run worker`                        | the queue consumer alone      |
| `bun test`                              | 102 unit/integration + 26 e2e |
| `bun run lint` · `format` · `typecheck` | oxlint · oxfmt · tsc          |
| `bun run mig:gen` · `mig:run`           | drizzle migrations            |
| `bun run build`                         | production build of both apps |

## Deploying

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

cloudflared, Redis, the API (which also serves the built client) and the worker. Both app containers are the same image with a different command, and both mount the same SQLite volume — WAL plus a busy timeout is what makes one file with two writers safe, which is also why they must stay on one host.

`APP_ENV=prod` makes `BETTER_AUTH_SECRET` mandatory; the image refuses to boot without one.

> **The `app` service cannot be scaled past one replica.** The tick loop must run in exactly one process — see `GameModule.forRoot({ engine })`.

## License

[MIT](LICENSE.md)
