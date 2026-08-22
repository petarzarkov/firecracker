import { Module } from '@dunx/core';
import { ClientSeedService } from './client-seed.service.js';

/**
 * The provable-RNG boundary.
 *
 * `fairness.ts` needs no module - it is pure statics and any file may import it. What
 * needs one is `ClientSeedService`, and like the engine there must be exactly one of
 * it: two nonce counters are the signal that somebody gave this module a `forRoot()`
 * and its three importers each got their own scope. See `GameEngineModule`.
 *
 * Imports nothing: `RedisConnection`, `AppConfigService` and `Logger` are all
 * `global: true`.
 */
@Module({
  providers: [ClientSeedService],
  exports: [ClientSeedService],
})
export class GameFairnessModule {}
