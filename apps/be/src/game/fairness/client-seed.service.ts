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
 * The per-round client-seed pool and the nonce. One class rather than four files
 * reaching for one Redis key, because this lifecycle *is* the fairness ordering:
 * contribute during the window, `collect` once it shuts, draw, then `discard`.
 *
 * `collect` earlier would let the house draw before the players finished
 * contributing; `discard` before the draw would let a retry launch from an empty
 * pool and record it as fair.
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
   * Keyed by user where there is one, so a player cannot stuff the pool with a seed
   * per socket. A spectator still contributes, keyed by connection.
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
   * `HSETNX`, so a seed the player submitted themselves is never overwritten.
   * Failing is survivable - one seed fewer - so it does not take a bet down.
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
   * The folded pool, or `null` when Redis could not be asked - and that distinction
   * is the whole point. An empty hash is a normal idle lobby, but a failed *read*
   * returning the same `{}` drew the crash point from the server seed alone, a
   * value the house committed at creation, in a record identical to an idle
   * lobby's.
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
