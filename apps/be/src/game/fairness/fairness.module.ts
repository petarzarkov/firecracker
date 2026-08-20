import { Module } from '@dunx/core';
import { ClientSeedService } from './client-seed.service.js';

/**
 * The provable-RNG boundary.
 *
 * `fairness.ts` needs no module - it is pure statics and any file may import it.
 * What needs one is `ClientSeedService`, because the per-round pool is in Redis and
 * there must be exactly **one** of it: two would be two nonce counters, and while
 * they `INCR` the same key and so stay monotonic, two is the signal that somebody
 * gave this module a `forRoot()` and its three importers each got their own scope.
 *
 * Nothing here to configure, so nothing to configure it with. Imports nothing:
 * `RedisConnection`, `AppConfigService` and `Logger` are all `global: true`.
 */
@Module({
  providers: [ClientSeedService],
  exports: [ClientSeedService],
})
export class GameFairnessModule {}
