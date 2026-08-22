import { Module } from '@dunx/core';
import { GameBettingModule } from './betting/betting.module.js';
import { GameBotsModule } from './bots/bots.module.js';
import { GameEngineModule } from './engine/engine.module.js';
import { GameFairnessModule } from './fairness/fairness.module.js';
import { GameRoundsModule } from './rounds/rounds.module.js';
import { GameSurfaceModule } from './surface/surface.module.js';

/**
 * The crash game: a facade over six modules and nothing of its own. The split makes
 * three invariants properties of the graph - bots cannot see `GameBetService`, the
 * engine exports the one clock, and the verifiable half is all under `fairness/`.
 *
 * Two rules, each one edit from breaking something. **No game sub-module carries
 * `global: true`**, or adding it to `Foundation.for()` would give every bullmq fork
 * a second clock. **None carries a `static forRoot()`**, which is what produces two
 * engines and two nonce counters.
 *
 * Import order is construction order: fairness and betting first, then rounds, the
 * engine, and the surface.
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
