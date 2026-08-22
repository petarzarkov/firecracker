import { Module } from '@dunx/core';
import { GameBettingModule } from '../betting/betting.module.js';
import { GameFairnessModule } from '../fairness/fairness.module.js';
import { GameRoundRepository } from './game-round.repository.js';
import { GameRoundService } from './game-round.service.js';
import { GameRoundWatchdog } from './round-watchdog.service.js';
import { RoundJobs } from './round.jobs.js';

/**
 * The lifecycle: create, launch, settle, and sweep up what stalled.
 *
 * `RoundJobs` and `GameRoundWatchdog` are **not exported**, because nothing injects
 * them. BullMQ still finds the `@JobHandler` methods - it walks every module in the
 * graph and resolves the declaring class through the container - and `game.spec.ts`
 * still reaches the watchdog, because `app.get` without a `from` falls back to any
 * single scope that declares the token. Which is also the rule that makes this
 * safe: a provider class must appear in exactly one `providers` array in the whole
 * graph, or that fallback becomes ambiguous.
 *
 * Imports betting and never the reverse - see `GameBettingModule`.
 */
@Module({
  imports: [GameBettingModule, GameFairnessModule],
  providers: [
    GameRoundRepository,
    GameRoundService,
    RoundJobs,
    GameRoundWatchdog,
  ],
  exports: [GameRoundRepository, GameRoundService],
})
export class GameRoundsModule {}
