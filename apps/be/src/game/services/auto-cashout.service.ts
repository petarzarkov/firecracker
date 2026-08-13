import { Logger } from '@dunx/core';
import { RedisConnection } from '@dunx/infra/redis';
import { EventsPublisher } from '../../notifications/events/events.publisher.js';
import { userTopic } from '../../notifications/events/events.js';
import { GAME_EVENTS, GAME_TOPIC } from '../game.events.js';
import { toMultiplier } from '../game.math.js';
import { GameBetService } from './game-bet.service.js';
import { WalletService } from './wallet.service.js';

/** Where a round's pending auto-cashouts live while it runs. */
const key = (roundId: string): string => `game:auto-cashout:${roundId}`;

/** How long the hash outlives the round it belongs to. */
const TTL_SECONDS = 3600;

interface Pending {
  readonly username: string;
  readonly autoCashOutAtX100: number;
  readonly isDemo: boolean;
}

/**
 * "Cash me out at 2x", and the tick loop that honours it.
 *
 * Split out of `GameGateway` because it is a mechanism rather than transport: it
 * owns a Redis hash, its lifetime is the round's rather than a connection's, and a
 * player who sets an auto-cashout and then closes the tab must still be paid.
 *
 * Redis rather than memory for exactly that last reason, and for one more: the
 * gateway process can restart mid-round, and a promise made to a player should not
 * depend on which process was holding it.
 */
export class AutoCashOutService {
  constructor(
    private readonly bets: GameBetService,
    private readonly wallets: WalletService,
    private readonly redis: RedisConnection,
    private readonly events: EventsPublisher,
    private readonly logger: Logger,
  ) {}

  async store(
    roundId: string,
    userId: string,
    username: string,
    autoCashOutAt: number,
    isDemo: boolean,
  ): Promise<void> {
    const hash = key(roundId);
    await this.redis.hset(hash, {
      [userId]: JSON.stringify({
        username,
        autoCashOutAtX100: Math.round(autoCashOutAt * 100),
        isDemo,
      } satisfies Pending),
    });
    await this.redis.expire(hash, TTL_SECONDS);
  }

  /**
   * Called on every tick. Cashes out everyone whose target the curve has reached.
   *
   * The payout multiplier is `min(current, target)`, not `current`: a player who
   * asked for 2.00x is paid 2.00x even if this tick landed on 2.03x, because the
   * tick interval is our granularity and not theirs.
   */
  async sweep(roundId: string, multiplierX100: number): Promise<void> {
    const hash = key(roundId);
    const pending = await this.redis.hgetall(hash).catch(() => ({}));

    for (const [userId, raw] of Object.entries(pending)) {
      let entry: Pending;
      try {
        entry = JSON.parse(raw) as Pending;
      } catch {
        await this.redis.hdel(hash, userId).catch(() => 0);
        continue;
      }

      if (entry.autoCashOutAtX100 > multiplierX100) continue;

      // Claimed before the payout, not after: this runs every tick, and a slow
      // write would otherwise let the next tick pay the same bet a second time.
      // `hdel` returning 0 means another tick got there first.
      const claimed = await this.redis.hdel(hash, userId).catch(() => 0);
      if (claimed === 0) continue;

      const at = Math.min(multiplierX100, entry.autoCashOutAtX100);
      try {
        const bet = this.bets.cashOut(userId, roundId, at, entry.isDemo);
        const wallet = this.wallets.getWallet(userId, entry.isDemo);

        this.events.publish(userTopic(userId), GAME_EVENTS.WALLET_UPDATED, {
          balanceCents: wallet.balanceCents,
          isDemo: entry.isDemo,
        });
        this.events.publish(GAME_TOPIC, GAME_EVENTS.BET_CASHED_OUT, {
          username: entry.username,
          multiplier: toMultiplier(at),
          payoutCents: bet.payoutCents ?? 0,
          isDemo: entry.isDemo,
        });
      } catch (error) {
        // Already cashed out by hand, or the round ended underneath us. Neither
        // is worth an error - the bet is settled either way.
        this.logger.debug('auto-cashout skipped', {
          userId,
          roundId,
          reason: (error as Error).message,
        });
      }
    }
  }
}
