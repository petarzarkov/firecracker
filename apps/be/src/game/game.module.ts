import { Module } from '@dunx/core';
import { GameBettingModule } from './betting/betting.module.js';
import { GameBotsModule } from './bots/bots.module.js';
import { GameEngineModule } from './engine/engine.module.js';
import { GameFairnessModule } from './fairness/fairness.module.js';
import { GameRoundsModule } from './rounds/rounds.module.js';
import { GameSurfaceModule } from './surface/surface.module.js';

/**
 * The crash game: a facade over six modules, and nothing of its own.
 *
 * It was one module with fourteen providers, and the split is not about file size.
 * It turns three invariants that were doc comments into properties of the graph:
 * `GameBotsModule` cannot see `GameBetService`, `GameEngineModule` exports one class
 * so "exactly one clock" is a diamond rather than a paragraph, and everything a
 * player re-runs to check us is under `fairness/`.
 *
 * Nothing is exported. `AppModule` is the only importer and declares no provider
 * that injects into the game.
 *
 * ## Two rules, and both are one edit away from breaking something
 *
 * **No game sub-module carries `global: true`.** If one did and somebody later
 * added it to `Foundation.for()`, `JobsModule` would build it - and if that module
 * were `GameEngineModule`, or anything that transitively imports it, every BullMQ
 * fork would be a second clock. `JobsModule` imports nothing from here, and that
 * has to stay true.
 *
 * **No game sub-module carries a `static forRoot()`.** There is nothing to
 * configure, and the only thing a factory buys is per-caller configuration - which
 * is precisely the mechanism that produces two engines and two nonce counters.
 * `forRoot()` returns a new object per call and scopes are keyed on the module
 * reference; a decorated class is deduped by reference, so five importers share
 * one instance and dunx keeps the resulting diamond silent. That is why sharing
 * here is free and why no binding below needs `global: true`.
 *
 * Import order is construction order: fairness and betting have no game-internal
 * dependencies, rounds needs both, the engine needs rounds, and the surface needs
 * everything.
 */
@Module({
  imports: [
    GameFairnessModule,
    GameBettingModule,
    GameRoundsModule,
    GameEngineModule,
    GameBotsModule,
    GameSurfaceModule,
  ],
})
export class GameModule {}
