import { Module } from '@dunx/core';
import { GameBettingModule } from './betting/betting.module.js';
import { GameBotsModule } from './bots/bots.module.js';
import { GameEngineModule } from './engine/engine.module.js';
import { GameFairnessModule } from './fairness/fairness.module.js';
import { GameRoundsModule } from './rounds/rounds.module.js';
import { GameSurfaceModule } from './surface/surface.module.js';

/**
 * The crash game: a facade over six modules, and nothing of its own. The split is
 * what makes three invariants properties of the graph rather than paragraphs:
 * `GameBotsModule` cannot see `GameBetService`, `GameEngineModule` exports the one
 * clock, and everything a player re-runs to check us is under `fairness/`.
 *
 * Nothing is exported. `AppModule` is the only importer and declares no provider
 * that injects into the game.
 *
 * Two rules, each one edit away from breaking something:
 *
 * **No game sub-module carries `global: true`.** If one did and somebody later
 * added it to `Foundation.for()`, `JobsModule` would build it - and if that module
 * were `GameEngineModule`, or anything that transitively imports it, every BullMQ
 * fork would be a second clock.
 *
 * **No game sub-module carries a `static forRoot()`.** Per-caller configuration is
 * what produces two engines and two nonce counters - see `GameEngineModule`.
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
