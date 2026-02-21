# Firecracker — Crash Game Implementation Plan

## Context

Build a live multiplayer rocket crash game ("Firecracker") on top of the existing NestJS monolith.
Players bet virtual credits before each round, then watch a rocket climb. The multiplier grows
exponentially; the rocket can explode at any moment. Players cash out before the crash to win
their bet × multiplier, or lose everything if they ride it too long.

Key constraints:
- No microservices — all logic lives in the NestJS monolith using BullMQ workers
- Reuse existing Socket.io + Redis adapter for real-time events
- Reuse existing BullMQ queue system for round lifecycle scheduling
- Stripe for wallet funding (deposit/withdraw real money)
- Demo mode: unauthenticated guests can play with virtual credits (no Stripe required)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  NestJS Monolith (firecracker)                              │
│                                                             │
│  GameModule                                                 │
│  ├── CrashEngineService  ── setInterval (100ms ticks) ──►  │
│  │       │                                                  │
│  │       └── publishJob(GAME_ROUND_CRASH) ──► BullMQ       │
│  │                                                          │
│  ├── GameGateway  ◄── Socket.io (game room) ──►  clients   │
│  │       ├── placeBet (auth or demo)                        │
│  │       └── cashOut  (auth or demo)                        │
│  │                                                          │
│  ├── GameLifecycleHandler  (@JobHandler on NOTIFICATIONS    │
│  │       queue — in-process, has NestJS DI access)          │
│  │       ├── GAME_ROUND_SCHEDULE → create round, wait 10s  │
│  │       ├── GAME_ROUND_START    → start engine + ticks     │
│  │       └── GAME_ROUND_CRASH   → settle bets, wait 5s     │
│  │                                                          │
│  ├── GameRoundService   — DB lifecycle                      │
│  ├── GameBetService     — place / cashout / settle          │
│  └── WalletService      — credits, Stripe deposit/withdraw  │
│                                                             │
│  BillingModule (existing) — Stripe customer management      │
│  RedisService  (existing) — demo wallet storage             │
│  PgLockModule  (existing) — advisory locks for bet safety   │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. New Files to Create

### 1.1 Module

```
src/game/
├── game.module.ts
├── game.controller.ts          # REST: /game/rounds, /game/my-bets, /game/state
├── wallet.controller.ts        # REST: /wallet (balance, deposit, withdraw, transactions)
├── game.gateway.ts             # WS: placeBet, cashOut handlers
├── engine/
│   └── crash-engine.service.ts
├── entity/
│   ├── game-round.entity.ts
│   ├── game-bet.entity.ts
│   ├── wallet.entity.ts
│   └── wallet-transaction.entity.ts
├── enum/
│   ├── game-round-status.enum.ts
│   ├── game-bet-status.enum.ts
│   └── wallet-transaction-type.enum.ts
├── repos/
│   ├── game-round.repository.ts
│   ├── game-bet.repository.ts
│   ├── wallet.repository.ts
│   └── wallet-transaction.repository.ts
├── services/
│   ├── game-round.service.ts
│   ├── game-bet.service.ts
│   └── wallet.service.ts
├── handlers/
│   └── game-lifecycle.handler.ts
└── dto/
    ├── game-ws.dto.ts           # WS payloads + GameWebSocketEmitEvents interface
    ├── game-round.dto.ts        # REST DTOs for rounds
    ├── game-bet.dto.ts          # REST DTOs for bets
    └── wallet.dto.ts            # REST DTOs for wallet
```

---

### 1.2 Entities

#### `game-round.entity.ts` — table: `game_round`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | `PK_game_round` |
| seed | varchar(128) | server seed; revealed only after crash |
| seedHash | varchar(128) | sha256(seed); sent to clients before round starts |
| crashPoint | decimal(10,2) | computed from seed at creation; never sent until crash |
| status | enum | `game_round_status_enum` |
| waitingEndsAt | timestamptz nullable | now + 10s when WAITING begins |
| startedAt | timestamptz nullable | when RUNNING began |
| crashedAt | timestamptz nullable | when crashed |
| createdAt | timestamptz | CreateDateColumn |
| updatedAt | timestamptz | UpdateDateColumn |

Constraints: `game_round_status_index` (status), `game_round_created_at_index` (createdAt),
`game_round_seed_hash_index` (seedHash, unique)

#### `game-bet.entity.ts` — table: `game_bet`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | `PK_game_bet` |
| roundId | uuid FK | `FK_game_bet_to_game_round` → game_round.id (CASCADE) |
| userId | uuid FK | `FK_game_bet_to_user` → user.id (CASCADE) |
| betAmountCents | integer | bet in cents |
| cashedOutAt | decimal(10,2) nullable | multiplier at cashout |
| payoutCents | integer nullable | betAmountCents × cashedOutAt |
| status | enum | `game_bet_status_enum` |
| createdAt | timestamptz | CreateDateColumn |
| updatedAt | timestamptz | UpdateDateColumn |

Constraints: `game_bet_round_id_index`, `game_bet_user_id_index`, `game_bet_status_index`

#### `wallet.entity.ts` — table: `wallet`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | `PK_wallet` |
| userId | uuid FK | `FK_wallet_to_user` → user.id (CASCADE) |
| balanceCents | integer | default 0 |
| createdAt | timestamptz | CreateDateColumn |
| updatedAt | timestamptz | UpdateDateColumn |

Constraints: `wallet_user_id_index` (userId, unique)

#### `wallet-transaction.entity.ts` — table: `wallet_transaction`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | `PK_wallet_transaction` |
| walletId | uuid FK | `FK_wallet_transaction_to_wallet` → wallet.id (CASCADE) |
| type | enum | `wallet_transaction_type_enum` |
| amountCents | integer | always positive; direction determined by type |
| balanceAfterCents | integer | snapshot post-transaction (audit trail) |
| stripePaymentIntentId | varchar(128) nullable | for deposits |
| gameBetId | uuid FK nullable | `FK_wallet_transaction_to_game_bet` → game_bet.id (SET NULL) |
| description | varchar(255) nullable | |
| createdAt | timestamptz | CreateDateColumn |

Constraints: `wallet_transaction_wallet_id_index`, `wallet_transaction_type_index`,
`wallet_transaction_stripe_pi_index` (stripePaymentIntentId, unique partial where NOT NULL)

---

### 1.3 Enums

```typescript
// game-round-status.enum.ts
export enum GameRoundStatus { WAITING = 'waiting', RUNNING = 'running', CRASHED = 'crashed' }

// game-bet-status.enum.ts
export enum GameBetStatus { ACTIVE = 'active', CASHED_OUT = 'cashed_out', LOST = 'lost' }

// wallet-transaction-type.enum.ts
export enum WalletTransactionType {
  DEPOSIT = 'deposit', WITHDRAWAL = 'withdrawal',
  BET_DEBIT = 'bet_debit', WIN_CREDIT = 'win_credit', REFUND = 'refund',
}
```

---

### 1.4 `CrashEngineService`

Singleton (`OnModuleInit` / `OnModuleDestroy`). Owns the in-process `setInterval` tick loop.

**In-memory state:**
```typescript
private currentRoundId: string | null
private currentPhase: GameRoundStatus
private roundStartedAt: Date | null
private crashPoint: number | null  // secret until crash
private tickInterval: NodeJS.Timeout | null
```

**`onModuleInit`:** Query DB for any active round.
- If RUNNING → reattach: resume tick from current elapsed; if already past crash point, publish CRASH job immediately.
- If WAITING → compute remaining wait, re-publish GAME_ROUND_START with remaining delay.
- If none → publish GAME_ROUND_SCHEDULE (delay: 0) to start first round.

**Crash point generation (provably fair, 1% house edge):**
```typescript
generateCrashPoint(seed: string): number {
  const hash = createHmac('sha256', seed).digest('hex');
  const h = parseInt(hash.slice(0, 13), 16);
  const e = Math.pow(2, 52);
  return Math.max(1.0, Math.floor((100 * e - h) / (e - h)) / 100);
}
```

**Multiplier formula (exponential growth):**
```
multiplier = floor(exp(elapsed_ms / 15000) * 100) / 100
```
Reaches ~1.7x at 8s, ~3.0x at 16s, ~7.4x at 30s.

**Tick (every 100ms):**
1. Compute `elapsed` and `multiplier`.
2. If `multiplier >= crashPoint`: clear interval, publish GAME_ROUND_CRASH (no delay).
3. Otherwise: `gameGateway.emitTick({ multiplier, elapsed })` to `game` room.

**`getCurrentMultiplier(): number`** — called synchronously by `GameBetService.cashOut()`.
Throws `BadRequestException('Round not running')` if phase ≠ RUNNING.

**`startRunning(roundId, crashPoint)`** — called by `handleStartRound` job handler after
DB transition. Sets state and starts setInterval.

**`onModuleDestroy`** — clears interval.

---

### 1.5 `GameRoundService`

- `createNextRound()` — generates seed + seedHash + crashPoint, saves `GameRound { status: WAITING, waitingEndsAt: now+10s }`
- `transitionToRunning(roundId)` — validates WAITING, sets RUNNING + startedAt, calls `crashEngineService.startRunning()`
- `transitionToCrashed(roundId)` — runs in DB transaction: sets CRASHED + crashedAt, calls `gameBetService.settleAllBets(roundId, crashPoint, manager)`
- `getCurrentRound()` — finds round with status IN (WAITING, RUNNING)
- `getRoundHistory(pageOptions)` — cursor-paginated crashed rounds

---

### 1.6 `GameBetService`

- `placeBet(userId, roundId, betAmountCents)` — advisory locked per user+round; validates WAITING phase + sufficient balance; atomic wallet debit + bet insert + transaction record.
- `cashOut(userId, roundId)` — validates RUNNING + active bet; captures multiplier synchronously from engine; DB transaction: update bet (CASHED_OUT, cashedOutAt, payoutCents) + wallet credit + transaction record.
- `settleAllBets(roundId, crashPoint, manager)` — bulk UPDATE: `status='lost'` WHERE `status='active'` AND `round_id=?`.

---

### 1.7 `WalletService`

- `getWallet(userId)` — `getOrCreate` via repository
- `createDepositSession(userId, amountCents)` — Stripe `paymentIntents.create({ amount, currency:'usd', metadata:{ userId, type:'wallet_deposit' } })`, returns `{ clientSecret }`
- `handleDepositWebhook(paymentIntentId, amountCents, userId)` — idempotency check on `stripePaymentIntentId`; credits wallet; records DEPOSIT transaction; emits `walletUpdated` to `user_{id}` WS room
- `withdraw(userId, amountCents)` — deducts balance; records WITHDRAWAL transaction; marks as "pending manual review" for initial implementation
- `getTransactions(userId, pageOptions)` — cursor-paginated

---

### 1.8 `GameLifecycleHandler`

Three `@JobHandler` methods on `EVENTS.QUEUES.NOTIFICATIONS_EVENTS` (in-process, full DI access):

```typescript
@JobHandler({ queue: NOTIFICATIONS_EVENTS, name: GAME_ROUND_SCHEDULE })
handleScheduleRound()
  → gameRoundService.createNextRound()
  → gameGateway.emitPhaseChange({ phase: WAITING, roundId, waitingEndsAt, seedHash })
  → publishJob(GAME_ROUND_START, { roundId }, { delay: 10_000 })

@JobHandler({ queue: NOTIFICATIONS_EVENTS, name: GAME_ROUND_START })
handleStartRound({ roundId })
  → gameRoundService.transitionToRunning(roundId)        // also calls crashEngine.startRunning()
  → gameGateway.emitPhaseChange({ phase: RUNNING, roundId })

@JobHandler({ queue: NOTIFICATIONS_EVENTS, name: GAME_ROUND_CRASH })
handleCrashRound({ roundId })
  → gameRoundService.transitionToCrashed(roundId)        // settles all active bets inside tx
  → gameGateway.emitCrashed({ roundId, crashPoint, seed, crashedAt })
  → publishJob(GAME_ROUND_SCHEDULE, {}, { delay: 5_000, jobId: 'game-round-schedule' })
```

`jobId: 'game-round-schedule'` on SCHEDULE jobs prevents double-scheduling on restart.

---

### 1.9 `GameGateway`

`@WebSocketGateway()` — shares the same Socket.io server as `EventsGateway` (NestJS merges gateways).

**`handleConnection(client)`**
- Joins `ROOMS.GAME` regardless of auth status (both authenticated and demo users)
- If authenticated: also joins `ROOMS.user(user.id)` for private `walletUpdated` / `betAck` / `cashOutAck`
- Sends `gameRoundState` to the new client (current phase, seedHash, multiplier if running)

**`@SubscribeMessage('placeBet')` — `{ betAmountCents: number }`**
- If authenticated: `GameBetService.placeBet(user.id, currentRoundId, betAmountCents)`; broadcast `betPlaced` to `ROOMS.GAME`; send `betAck` + `walletUpdated` to user's private room.
- If demo: `DemoService.placeDemoBet(socketId, currentRoundId, betAmountCents)` (Redis-backed); broadcast `betPlaced` to `ROOMS.GAME` with `isDemo: true`.

**`@SubscribeMessage('cashOut')`**
- If authenticated: `GameBetService.cashOut(...)`, broadcast `betCashedOut` to `ROOMS.GAME`, send `cashOutAck` + `walletUpdated` to user's private room.
- If demo: `DemoService.cashOutDemo(socketId)`, broadcast `betCashedOut` with `isDemo: true`.

**Emission helpers (called by CrashEngineService and GameLifecycleHandler):**
```typescript
emitTick(data: GameTickPayload): void          // io.to(ROOMS.GAME).emit('gameTick', data)
emitPhaseChange(data: GamePhasePayload): void   // io.to(ROOMS.GAME).emit('gamePhaseChange', data)
emitCrashed(data: GameCrashedPayload): void     // io.to(ROOMS.GAME).emit('gameCrashed', data)
```

---

### 1.10 Demo Mode — `DemoService`

Redis-backed virtual wallet for unauthenticated guests. Lives in `src/game/services/demo.service.ts`.

**Redis key schema:**
```
demo:wallet:{socketId}     → JSON: { balanceCents: number, username: string, createdAt: ISO }  TTL: 2h
demo:bet:{roundId}:{socketId} → JSON: { betAmountCents: number, placedAt: ISO }  TTL: 1h
```

**`getOrCreateDemoWallet(socketId)`** — if key missing, create with `balanceCents: 100_000` (1,000 demo credits = $1000 virtual) and username `Rocket#${random 4-digit}`.

**`placeDemoBet(socketId, roundId, betAmountCents)`**
- Check existing bet for this round (reject duplicate)
- Check demo balance ≥ betAmountCents
- Atomic Redis: DECRBY `demo:wallet:{socketId}` and SET `demo:bet:{roundId}:{socketId}`

**`cashOutDemo(socketId, roundId, multiplier)`**
- Read bet; calculate `payoutCents = floor(betAmountCents × multiplier)`
- INCRBY `demo:wallet:{socketId}` by payoutCents
- Update bet key to mark cashed out
- Return `{ payoutCents, newBalance }`

**`settleDemoBets(roundId)`** — called by `GameLifecycleHandler.handleCrashRound()` after DB settlement.
- Scan `demo:bet:{roundId}:*` keys
- Mark uncashed bets as lost (delete or flag in Redis)
- Emit `walletUpdated` to each socket's private demo channel

**Demo bets on the leaderboard:** `betPlaced` events broadcast `{ username: 'Rocket#4821', betAmountCents, isDemo: true }`. Client can render demo players with a ghost/virtual badge.

---

## 2. Files to Modify

### 2.1 `src/notifications/events/events.ts`

Add game routing keys and payload types:

```typescript
// In EVENTS.ROUTING_KEYS:
GAME_ROUND_SCHEDULE: 'game.round.schedule',
GAME_ROUND_START: 'game.round.start',
GAME_ROUND_CRASH: 'game.round.crash',

// In EventMap:
[EVENTS.ROUTING_KEYS.GAME_ROUND_SCHEDULE]: Record<never, never>,
[EVENTS.ROUTING_KEYS.GAME_ROUND_START]: { roundId: string },
[EVENTS.ROUTING_KEYS.GAME_ROUND_CRASH]: { roundId: string },
```

### 2.2 `src/notifications/events/events.dto.ts`

1. Change `ExtendedSocket` to allow `user: SanitizedUser | null` (guest support):
```typescript
export class ExtendedSocket extends Socket<
  DefaultEventsMap,
  WebSocketEmitEvents,
  DefaultEventsMap,
  { user: SanitizedUser | null }   // null = demo/guest
> {}
```

2. Add game events to `WebSocketEmitEvents`:
```typescript
gameTick: (data: GameTickPayload) => void;
gamePhaseChange: (data: GamePhasePayload) => void;
gameCrashed: (data: GameCrashedPayload) => void;
gameRoundState: (data: GameRoundStatePayload) => void;
betPlaced: (data: BetPlacedPayload) => void;
betCashedOut: (data: BetCashedOutPayload) => void;
betAck: (data: BetAckPayload) => void;
cashOutAck: (data: CashOutAckPayload) => void;
walletUpdated: (data: WalletUpdatedPayload) => void;
```

### 2.3 `src/notifications/events/events.gateway.ts`

**Auth middleware** — make JWT optional to support demo mode:
```typescript
// In #createAuthMiddleware():
if (!authHeader) {
  socket.data.user = null;   // guest/demo connection allowed
  return next();
}
// rest of JWT validation unchanged
```

**`handleConnection`** — guard `user` being null (already partially guarded in disconnect):
```typescript
const user = client.data.user;
const rooms = [ROOMS.CHAT];
if (user) {
  rooms.push(ROOMS.user(user.id));
  if (user.roles.includes(UserRole.ADMIN)) rooms.push(ROOMS.ADMINS);
}
await client.join(rooms);
// emit 'connected' only if user exists (chat join notification only for auth users)
```

**`chatMessage` handler** — guard: throw `WsException('Unauthorized')` if `!client.data.user`.
**`aiRequest` handler** — same guard.

### 2.4 `src/constants.ts`

Add game constants:
```typescript
export const GAME = {
  WAITING_PHASE_MS: 10_000,
  COOLDOWN_MS: 5_000,
  TICK_INTERVAL_MS: 100,
  MULTIPLIER_DIVISOR: 15_000,
  MIN_BET_CENTS: 100,          // $1
  DEMO_INITIAL_BALANCE_CENTS: 100_000,   // $1,000 virtual
  DEMO_WALLET_TTL_SECONDS: 7_200,        // 2 hours
} as const;
```

### 2.5 `src/app.module.ts`

Add `GameModule` to imports after `BillingModule`:
```typescript
import { GameModule } from './game/game.module';
// ...
GameModule,
```

### 2.6 `src/billing/billing.controller.ts`

Extend the Stripe webhook handler to forward wallet deposit confirmations:
```typescript
case 'payment_intent.succeeded': {
  const pi = event.data.object as Stripe.PaymentIntent;
  if (pi.metadata?.type === 'wallet_deposit') {
    await this.walletService.handleDepositWebhook(pi.id, pi.amount, pi.metadata.userId);
  }
  break;
}
```
Inject `WalletService` into `BillingController`. `BillingModule` must import `GameModule` for
this (or use `forwardRef` to avoid circular dependency).

**Alternative (preferred):** Create a separate Stripe webhook endpoint in `WalletController`:
`POST /wallet/webhook/stripe` with `@Public()` + raw body parsing. This avoids any module
coupling between `BillingModule` and `GameModule`.

---

## 3. WebSocket Event Contract

### Server → Client

| Event | Room | Payload |
|-------|------|---------|
| `gameRoundState` | sender only | `{ phase, roundId, seedHash, waitingEndsAt?, multiplier?, elapsed?, activeBets: BetSummary[] }` |
| `gamePhaseChange` | `game` | `{ phase, roundId, seedHash, waitingEndsAt? }` |
| `gameTick` | `game` | `{ multiplier: number, elapsed: number }` |
| `gameCrashed` | `game` | `{ roundId, crashPoint, crashedAt, seed }` (seed revealed for provably fair verify) |
| `betPlaced` | `game` | `{ userId?, username, betAmountCents, isDemo: boolean }` |
| `betCashedOut` | `game` | `{ userId?, username, multiplier, payoutCents, isDemo: boolean }` |
| `betAck` | `user_{id}` | `{ success: boolean, bet?: GameBetResponseDto, error?: string }` |
| `cashOutAck` | `user_{id}` | `{ success: boolean, multiplier?: number, payoutCents?: number, error?: string }` |
| `walletUpdated` | `user_{id}` | `{ balanceCents: number }` |

### Client → Server

| Message | Payload | Auth Required |
|---------|---------|--------------|
| `placeBet` | `{ betAmountCents: number }` | No (demo or real) |
| `cashOut` | `{}` | No (demo or real) |

---

## 4. BullMQ Round Lifecycle

```
App boot (onModuleInit)
    │
    └─ No active round → publishJob(GAME_ROUND_SCHEDULE, {})
                                │
                                ▼  [in-process, NOTIFICATIONS queue]
                   handleScheduleRound()
                   ├─ gameRoundService.createNextRound()
                   │  └─ seed, seedHash, crashPoint computed & saved
                   ├─ emitPhaseChange({ phase: WAITING, waitingEndsAt, seedHash })
                   └─ publishJob(GAME_ROUND_START, { roundId }, delay: 10_000)
                                │
                     ─────── 10 seconds ──────
                                │
                                ▼
                   handleStartRound({ roundId })
                   ├─ gameRoundService.transitionToRunning(roundId)
                   │  └─ crashEngineService.startRunning(roundId, crashPoint)
                   │       └─ setInterval(100ms) begins
                   └─ emitPhaseChange({ phase: RUNNING, roundId })
                                │
                     ─── ticks until multiplier >= crashPoint ───
                                │
                   CrashEngineService.#triggerCrash()
                   └─ publishJob(GAME_ROUND_CRASH, { roundId })
                                │
                                ▼
                   handleCrashRound({ roundId })
                   ├─ gameRoundService.transitionToCrashed(roundId)
                   │  └─ tx: set CRASHED + gameBetService.settleAllBets()
                   ├─ demoService.settleDemoBets(roundId)
                   ├─ emitCrashed({ roundId, crashPoint, seed, crashedAt })
                   └─ publishJob(GAME_ROUND_SCHEDULE, {}, delay: 5_000, jobId: 'game-round-schedule')
                                │
                     ─────── 5 seconds ──────
                                │
                            (cycle repeats)
```

**Idempotency guards:**
- `transitionToRunning`: noop if status already RUNNING (duplicate job protection)
- `transitionToCrashed`: noop if status already CRASHED
- `jobId: 'game-round-schedule'` deduplicates cooldown scheduling

---

## 5. Wallet & Stripe Deposit Flow

```
Client                        Backend (WalletController)              Stripe
  │                                      │                              │
  ├─ POST /wallet/deposit/session ──────►│                              │
  │   { amountCents: 500 }              │                              │
  │                          WalletService.createDepositSession()       │
  │                                      ├─ stripe.paymentIntents.create(500, metadata) ──►│
  │                                      │◄── { client_secret } ────────────────────────────│
  │◄─ { clientSecret } ─────────────────│                              │
  │                                      │                              │
  │  (Stripe.js confirms card client-side)                              │
  │                                      │◄── webhook: payment_intent.succeeded ────────────│
  │                          WalletService.handleDepositWebhook()       │
  │                          └─ idempotency check (stripePaymentIntentId)
  │                          └─ creditCents atomic UPDATE               │
  │                          └─ record WalletTransaction                │
  │◄─ walletUpdated { balanceCents } via WS ────────────────────────────│
```

**Withdrawal (v1 — manual review):**
- `POST /wallet/withdraw { amountCents }` — validates balance, creates WITHDRAWAL transaction,
  deducts balance, creates a pending payout record for admin review.
- Stripe Payouts (full automation) is a future enhancement requiring Stripe Connect.

---

## 6. Demo Mode Summary

| Feature | Authenticated User | Demo / Guest |
|---------|-------------------|--------------|
| Watch game | ✓ | ✓ |
| Place bets | Real credits from wallet | Virtual credits (Redis, resets on TTL) |
| Starting balance | Wallet balance | $1,000 virtual |
| Cashout winnings | Real credits to wallet | Virtual credits |
| Deposit/Withdraw | Stripe | N/A |
| History persisted | DB (game_bet) | Redis only |
| Appears on leaderboard | Yes | Yes (with "Demo" badge) |
| WS auth required | JWT token | None (optional) |

**Connection flow for demo:** Client connects to Socket.io without auth token → backend sets
`socket.data.user = null` → GameGateway joins the socket to `game` room → DemoService creates
virtual wallet in Redis keyed by `socketId`.

---

## 7. REST API Endpoints

### Game (all `@ApiJwtAuth` unless noted)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/game/state` | Public | Current round state + caller's active bet |
| GET | `/game/rounds` | Public | Cursor-paginated round history (only CRASHED) |
| GET | `/game/rounds/:id` | Public | Round detail + all bets |
| GET | `/game/my-bets` | JWT | Caller's bet history |

### Wallet

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/wallet` | JWT | Current balance |
| GET | `/wallet/transactions` | JWT | Cursor-paginated transaction history |
| POST | `/wallet/deposit/session` | JWT | Create Stripe PaymentIntent → `{ clientSecret }` |
| POST | `/wallet/withdraw` | JWT | Request withdrawal (v1: manual review) |
| POST | `/wallet/webhook/stripe` | `@Public` | Stripe webhook endpoint |

---

## 8. Database Migration

Single migration: `bun run mig:gen AddGameModule`

Migration creates (in order):
1. `game_round_status_enum` type
2. `game_round` table + indexes
3. `game_bet_status_enum` type
4. `game_bet` table + FKs + indexes
5. `wallet_transaction_type_enum` type
6. `wallet` table + unique index
7. `wallet_transaction` table + FKs + indexes

`down()` drops tables in reverse order then drops enum types.

---

## 9. Client — `firecracker-client` (in `repos/rocket`)

Copy `rocket-crash-client` → rename to `firecracker-client`. Remove `@draftkings/arena-rocket-sdk`.

### New files

**`src/services/SocketService.ts`** — Direct Socket.io client:
```typescript
class FirecrackerSocketService {
  connect(token?: string): void   // token optional for demo mode
  disconnect(): void
  onGameTick(cb): () => void
  onPhaseChange(cb): () => void
  onCrashed(cb): () => void
  onBetPlaced(cb): () => void
  onWalletUpdated(cb): () => void
  placeBet(betAmountCents: number): void
  cashOut(): void
}
```

**`src/services/ApiService.ts`** — Direct HTTP client:
```typescript
class ApiService {
  setToken(token: string): void
  getWallet(): Promise<WalletResponse>
  createDepositSession(amountCents: number): Promise<{ clientSecret: string }>
  getCurrentRound(): Promise<CurrentRoundResponse>
  getMyBets(cursor?: string): Promise<PageResponse<GameBetResponse>>
}
```

**`src/store/gameStore.ts`** — Lightweight store (Zustand or custom):
```typescript
interface GameStore {
  phase: 'connecting' | 'waiting' | 'running' | 'crashed'
  roundId: string | null
  multiplier: number
  elapsed: number
  waitingEndsAt: Date | null
  crashPoint: number | null      // only after crash
  seedHash: string | null
  seed: string | null            // revealed after crash
  activeBets: BetSummary[]
  walletBalanceCents: number
  demoBalanceCents: number
  myActiveBet: { betAmountCents: number } | null
  isDemo: boolean
}
```

**`src/components/WalletWidget/`** — Balance display + Deposit modal (Stripe.js Elements).

**`src/types/game.types.ts`** — TypeScript interfaces mirroring server WS payloads.

### Changes to existing files

- `webpack.dev.config.js` / `webpack.prod.config.js`: update env vars to point to firecracker backend
- `src/components/SideMenu/`: wire bet input and cashout button to `SocketService`
- `RocketChart/`: remove SDK event subscriptions; add `SocketService.onGameTick` subscription
- Redux middleware files: remove all SDK middleware; wire directly to SocketService

---

## 10. Implementation Phases

### Phase 1 — Schema & Constants (no behavior)
1. Create all enum files
2. Create all entity files with correct constraint names
3. Add game routing keys to `events.ts`
4. Add game WS types to `events.dto.ts` (extend `WebSocketEmitEvents`, update `ExtendedSocket`)
5. Add `GAME` constants to `constants.ts`
6. Generate + review + run migration: `bun run mig:gen AddGameModule && bun run mig:run`

### Phase 2 — Data Layer
7. Create all 4 repositories
8. Write unit tests for repository methods

### Phase 3 — Services
9. `WalletService` (without Stripe first — just credit/debit)
10. `GameRoundService`
11. `GameBetService`
12. `DemoService` (Redis-backed virtual wallet)

### Phase 4 — Game Engine + Job Handlers
13. `CrashEngineService` (tick loop, crash generation, restart recovery)
14. `GameLifecycleHandler` (@JobHandler methods)
15. Modify `events.gateway.ts` auth middleware (allow guest connections)
16. Test full round lifecycle locally: confirm rounds cycle automatically

### Phase 5 — WebSocket Gateway
17. `GameGateway` (placeBet, cashOut, emit helpers, handleConnection for game room)
18. E2E test: connect as auth user + demo user, place bets, cashout, observe crash settlement

### Phase 6 — REST & Wallet
19. `GameController` + `WalletController`
20. Stripe PaymentIntent deposit flow + webhook endpoint
21. Test: deposit → wallet credit → bet → cashout → balance update

### Phase 7 — Module Assembly
22. `GameModule` (wire all providers, repos, entities)
23. Add to `AppModule`
24. Integration test: full flow from app boot

### Phase 8 — Client
25. Create `firecracker-client` from `rocket-crash-client` boilerplate
26. `SocketService` + `ApiService`
27. Game store + chart adaptation
28. WalletWidget + Stripe.js integration
29. Demo mode UX (connect without auth, virtual balance display)

### Phase 9 — Testing & Polish
30. Unit tests: `generateCrashPoint` provably fair formula, `GameBetService.placeBet` edge cases
31. E2E tests: full round lifecycle, concurrent bet safety, demo mode settlement
32. Load test: 1000 concurrent WS connections, multiplier broadcast throughput

---

## 11. Key File Paths

| File | Purpose |
|------|---------|
| [src/notifications/events/events.ts](../src/notifications/events/events.ts) | Add game routing keys + EventMap entries |
| [src/notifications/events/events.dto.ts](../src/notifications/events/events.dto.ts) | Extend WebSocketEmitEvents + make user nullable |
| [src/notifications/events/events.gateway.ts](../src/notifications/events/events.gateway.ts) | Make auth optional for demo mode |
| [src/constants.ts](../src/constants.ts) | Add GAME constants |
| [src/app.module.ts](../src/app.module.ts) | Import GameModule |
| [src/infra/queue/queue.module.ts](../src/infra/queue/queue.module.ts) | No changes needed — reuse NOTIFICATIONS queue |
| [src/billing/billing.controller.ts](../src/billing/billing.controller.ts) | Add wallet_deposit webhook case (or use separate WalletController webhook) |
| `src/game/` | All new game module files |
| `src/infra/db/migrations/` | New migration for game entities |
| `repos/rocket/firecracker-client/` | New client (copy of rocket-crash-client) |

---

## 12. Reusable Utilities (no changes needed)

| Utility | Path | Used for |
|---------|------|---------|
| `PaginationFactory` | `src/core/pagination/` | Round history, bet history, transaction history |
| `PgLockService` | `src/infra/db/lock/` | Advisory lock for `placeBet` per user+round |
| `JobPublisherService` | `src/infra/queue/services/` | Publishing all game lifecycle jobs |
| `RedisService` | `src/infra/redis/services/` | Demo wallet Redis connections |
| `ContextLogger` | `src/infra/logger/` | Logging throughout game module |
| `AppConfigService` | `src/config/services/` | Env config access in wallet/stripe |
| `@Public()` | `src/core/decorators/` | Stripe webhook endpoint + game state endpoint |
| `@CurrentUser()` | `src/core/decorators/` | Extract user in REST controllers |
| `@UUIDParam()` | `src/core/decorators/` | roundId path params |
