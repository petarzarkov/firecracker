import { Module } from '@dunx/core';
import { GameRoundsModule } from '../rounds/rounds.module.js';
import { CrashEngineService } from './crash-engine.service.js';

/**
 * The clock, and **exactly one of it**.
 *
 * This is the module where being decorated rather than configured matters most.
 * `forRoot()` returns a new object per call and a scope is keyed on the module
 * reference, so two importers of a configured module get two scopes and two
 * engines - each ticking its own multiplier and each enqueuing its own crash job,
 * which a client sees as the number stuttering between two timelines. A decorated
 * class is deduped by reference, so the surface and the bots share one. There is a
 * test for it in `game.spec.ts`.
 *
 * One export and one import, which is the other half of the point: anything that
 * wants the clock has to say so, and the clock itself can only see
 * `GameRoundRepository`. It has no path to a bet, a wallet or the seed pool.
 */
@Module({
  imports: [GameRoundsModule],
  providers: [CrashEngineService],
  exports: [CrashEngineService],
})
export class GameEngineModule {}
