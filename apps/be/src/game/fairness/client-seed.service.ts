import { Logger } from '@dunx/core';
import { RedisConnection } from '@dunx/infra/redis';
import { AppConfigService } from '../../config/app.config.service.js';
import { Fairness } from './fairness.js';

/** Where the monotonic per-round nonce lives. One `INCR`, no contention. */
const NONCE_KEY = 'game:round:nonce';

/** How long a pool outlives the betting window it belongs to. */
const GRACE_SECONDS = 30;

/** What a launch consumes: the folded seed, and how many players were behind it. */
export interface CollectedSeeds {
  readonly clientSeed: string;
  readonly count: number;
}

/**
 * The per-round client-seed pool, from a player's contribution to the value the
 * draw consumes to the discard after the launch - and the nonce. One class rather
 * than four files reaching for one Redis key with raw verbs, because that lifecycle
 * *is* the fairness ordering and it has to be readable in one place:
 *
 * 1. The round is created with `SHA256(serverSeed)` committed and **no crash point**.
 * 2. The betting window: {@link ClientSeedService.contribute} for a player who sends
 *    one, {@link ClientSeedService.contributeIfAbsent} for a player who just bets.
 * 3. The window shuts, {@link ClientSeedService.collect} folds the pool, and only
 *    then is the crash point drawn from it.
 * 4. {@link ClientSeedService.discard} runs **after** the draw, so a job retry that
 *    lost the transition race still had the seeds it needed.
 *
 * Moving `collect` earlier would let the house draw before the players had finished
 * contributing; moving `discard` before the draw would make a retry launch a round
 * from an empty pool while recording it as fair.
 *
 * There must be exactly one of these in the graph. Two would be two nonce counters -
 * harmless in itself, because they `INCR` the same key, but it is the clearest sign
 * that a module gained a `forRoot()` and its importers each got their own scope.
 */
export class ClientSeedService {
  /** Per-round hash of client seeds, written during WAITING and dropped after. */
  static #key(roundId: string): string {
    return `game:client-seeds:${roundId}`;
  }

  constructor(
    private readonly redis: RedisConnection,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  /** Atomically increments and returns the round nonce. */
  nextNonce(): Promise<number> {
    return this.redis.incr(NONCE_KEY);
  }

  /**
   * A player's own seed, keyed by whatever identifies them.
   *
   * Keyed by user where there is one, so a player cannot stuff the pool with one
   * seed per socket. A spectator still contributes, keyed by connection.
   */
  async contribute(
    roundId: string,
    field: string,
    seed: string,
  ): Promise<void> {
    const key = ClientSeedService.#key(roundId);
    await this.redis.hset(key, { [field]: seed });
    await this.redis.expire(key, this.#ttlSeconds());
  }

  /**
   * Entropy on a betting player's behalf, when they did not send any.
   *
   * `HSETNX`, so a seed the player submitted through `submitClientSeed` is never
   * overwritten by this. Failing is survivable - the pool is one seed smaller and
   * the round still launches - so it does not take a bet down with it.
   */
  async contributeIfAbsent(roundId: string, userId: string): Promise<void> {
    await this.redis
      .send('HSETNX', [
        ClientSeedService.#key(roundId),
        userId,
        Fairness.autoClientSeed(),
      ])
      .catch(() => undefined);
  }

  /**
   * The pool folded into the value the draw consumes, or `null` when Redis could
   * not be asked. Called at the launch transition and nowhere else.
   *
   * The distinction is the whole point, and it is not defensive coding. An empty
   * hash is normal - an idle lobby has no players and therefore no seeds - and
   * `Fairness.combine([])` is the constant `'firecracker'`. A *failed read* used to
   * produce the same `{}`, so the round drew its crash point from the server seed
   * alone, a value the house committed at creation and can compute in advance,
   * while recording itself as provably fair. Worse, that record is byte-for-byte
   * identical to an idle lobby's, so nothing afterwards distinguishes the two.
   */
  async collect(roundId: string): Promise<CollectedSeeds | null> {
    try {
      const submitted = await this.redis.hgetall(
        ClientSeedService.#key(roundId),
      );
      const seeds = Object.values(submitted);
      return { clientSeed: Fairness.combine(seeds), count: seeds.length };
    } catch (error) {
      this.logger.error('cannot launch a round without its client seeds', {
        roundId,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** The seeds are spent. After the draw, never before it. */
  async discard(roundId: string): Promise<void> {
    await this.redis.del(ClientSeedService.#key(roundId)).catch(() => 0);
  }

  /** The betting window, plus enough slack for the launch job to be late. */
  #ttlSeconds(): number {
    return (
      Math.ceil(this.config.get('game').waitingPhaseMs / 1000) + GRACE_SECONDS
    );
  }
}
