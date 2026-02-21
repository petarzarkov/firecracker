# Firecracker — Implementation Status

## Legend
- [ ] Not started
- [~] In progress
- [x] Complete

---

## Phase 1 — Schema & Constants
- [x] `src/game/enum/game-round-status.enum.ts`
- [x] `src/game/enum/game-bet-status.enum.ts`
- [x] `src/game/enum/wallet-transaction-type.enum.ts`
- [x] `src/game/entity/game-round.entity.ts`
- [x] `src/game/entity/game-bet.entity.ts`
- [x] `src/game/entity/wallet.entity.ts`
- [x] `src/game/entity/wallet-transaction.entity.ts`
- [x] Extend `src/notifications/events/events.ts` (game routing keys + EventMap)
- [x] Extend `src/notifications/events/events.dto.ts` (WebSocketEmitEvents + nullable user)
- [x] Add `GAME` constants to `src/constants.ts`
- [x] Generate + run migration (`bun run mig:gen AddGameModule && bun run mig:run`)

## Phase 2 — Data Layer
- [x] `src/game/repos/game-round.repository.ts`
- [x] `src/game/repos/game-bet.repository.ts`
- [x] `src/game/repos/wallet.repository.ts`
- [x] `src/game/repos/wallet-transaction.repository.ts`

## Phase 3 — Services
- [x] `src/game/services/wallet.service.ts`
- [x] `src/game/services/game-round.service.ts`
- [x] `src/game/services/game-bet.service.ts`
- [x] `src/game/services/demo.service.ts` (Redis virtual wallet)

## Phase 4 — Game Engine + Job Handlers
- [x] `src/game/engine/crash-engine.service.ts`
- [x] `src/game/handlers/game-lifecycle.handler.ts`
- [x] Modify `src/notifications/events/events.gateway.ts` (optional auth for demo mode)

## Phase 5 — WebSocket Gateway
- [x] `src/game/game.gateway.ts`

## Phase 6 — REST & Wallet
- [x] `src/game/dto/game-round.dto.ts`
- [x] `src/game/dto/game-bet.dto.ts`
- [x] `src/game/dto/wallet.dto.ts`
- [x] `src/game/game.controller.ts`
- [x] `src/game/wallet.controller.ts` (includes Stripe webhook endpoint)

## Phase 7 — Module Assembly
- [x] `src/game/game.module.ts`
- [x] Add `GameModule` to `src/app.module.ts`

## Phase 8 — Client
- [x] `client/src/store/gameStore.ts` (Zustand + Immer game state)
- [x] `client/src/systems/network/useGameSocket.ts` (WS event subscriptions)
- [x] `client/src/components/game/CrashChart.tsx` (SVG animated multiplier chart)
- [x] `client/src/components/game/BetPanel.tsx` (bet input + place/cashout button)
- [x] `client/src/components/game/PlayerList.tsx` (active bets table)
- [x] `client/src/components/game/RoundHistory.tsx` (recent crash points)
- [x] `client/src/components/game/WalletWidget.tsx` (balance + deposit button)
- [x] `client/src/components/game/Game.tsx` (main game view)
- [x] Replace `World` with `Game` in `App.tsx`
- [x] Strip 3D world components (World, Ground, NPC, etc.) and unused stores
- [x] Keep GlobalChat + PlayerChatDialogue (chat components preserved)

## Phase 9 — Testing
- [ ] Unit: `generateCrashPoint` provably fair formula
- [ ] Unit: `GameBetService.placeBet` edge cases (insufficient balance, duplicate bet)
- [ ] Unit: `WalletService.handleDepositWebhook` idempotency
- [ ] E2E: Full round lifecycle (schedule → wait → run → bet → cashout → crash → settle)
- [ ] E2E: Demo mode round participation
- [ ] E2E: Concurrent bets safety (advisory lock)

---

## Notes

### Architecture decisions
- Game WS events use `NOTIFICATIONS_EVENTS` queue (in-process, has NestJS DI/EventsGateway access)
- Multiplier captured synchronously before any `await` in cashout to avoid race conditions
- Chart uses SVG with logarithmic Y scale (1x–50x range); points accumulated from `gameTick` events
- Wallet balance fetched via REST on mount, updated in real-time via `walletUpdated` WS event
- Stripe payment UI in WalletWidget is a placeholder stub (clientSecret flow ready, Stripe.js integration pending)

### Known limitations / future work
- Stripe.js deposit modal not implemented (needs `@stripe/stripe-js` + `@stripe/react-stripe-js`)
- Mobile layout not optimized (sidebar collapses awkwardly on small screens)
- Demo/guest mode not wired in client (backend supports it, client requires auth)
