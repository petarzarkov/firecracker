import { BadRequestException, Injectable } from '@nestjs/common';
import { GAME } from '@/constants';
import { ContextLogger } from '@/infra/logger/services/context-logger.service';
import { RedisService } from '@/infra/redis/services/redis.service';

export interface DemoWallet {
  balanceCents: number;
  username: string;
  createdAt: string;
}

export interface DemoBet {
  betAmountCents: number;
  roundId: string;
  placedAt: string;
  cashedOut: boolean;
  cashedOutAt?: number;
  payoutCents?: number;
  autoCashOutAt?: number;
  username?: string;
}

@Injectable()
export class DemoService {
  private readonly redis;

  constructor(
    private readonly redisService: RedisService,
    private readonly logger: ContextLogger,
  ) {
    this.redis = this.redisService.newConnection('demo-game', { db: 5 });
  }

  private walletKey(socketId: string): string {
    return `demo:wallet:${socketId}`;
  }

  private betKey(roundId: string, socketId: string): string {
    return `demo:bet:${roundId}:${socketId}`;
  }

  private roundBetsPattern(roundId: string): string {
    return `demo:bet:${roundId}:*`;
  }

  async getOrCreateWallet(socketId: string): Promise<DemoWallet> {
    const key = this.walletKey(socketId);
    const raw = await this.redis.get(key);

    if (raw) {
      return JSON.parse(raw) as DemoWallet;
    }

    const suffix = Math.floor(1000 + Math.random() * 9000);
    const wallet: DemoWallet = {
      balanceCents: GAME.DEMO_INITIAL_BALANCE_CENTS,
      username: `Cracker#${suffix}`,
      createdAt: new Date().toISOString(),
    };

    await this.redis.set(
      key,
      JSON.stringify(wallet),
      'EX',
      GAME.DEMO_WALLET_TTL_SECONDS,
    );
    return wallet;
  }

  async getWallet(socketId: string): Promise<DemoWallet | null> {
    const raw = await this.redis.get(this.walletKey(socketId));
    return raw ? (JSON.parse(raw) as DemoWallet) : null;
  }

  async placeDemoBet(
    socketId: string,
    roundId: string,
    betAmountCents: number,
    autoCashOutAt?: number,
    username?: string,
  ): Promise<{ bet: DemoBet; wallet: DemoWallet }> {
    const betKey = this.betKey(roundId, socketId);

    // Check for existing bet
    const existingBet = await this.redis.get(betKey);
    if (existingBet) {
      throw new BadRequestException(
        'You already have an active demo bet in this round',
      );
    }

    // Get wallet and check balance
    const wallet = await this.getOrCreateWallet(socketId);
    if (wallet.balanceCents < betAmountCents) {
      throw new BadRequestException('Insufficient demo balance');
    }

    // Deduct balance
    wallet.balanceCents -= betAmountCents;
    await this.redis.set(
      this.walletKey(socketId),
      JSON.stringify(wallet),
      'EX',
      GAME.DEMO_WALLET_TTL_SECONDS,
    );

    // Record bet — prefer the real user's display name over the generated wallet name
    const bet: DemoBet = {
      betAmountCents,
      roundId,
      placedAt: new Date().toISOString(),
      cashedOut: false,
      username: username ?? wallet.username,
      ...(autoCashOutAt ? { autoCashOutAt } : {}),
    };
    await this.redis.set(betKey, JSON.stringify(bet), 'EX', 3600);

    this.logger.verbose('Demo bet placed', {
      socketId,
      roundId,
      betAmountCents,
      remainingBalance: wallet.balanceCents,
    });

    return { bet, wallet };
  }

  async cashOutDemo(
    socketId: string,
    roundId: string,
    currentMultiplier: number,
  ): Promise<{ bet: DemoBet; wallet: DemoWallet }> {
    const betKey = this.betKey(roundId, socketId);
    const raw = await this.redis.get(betKey);

    if (!raw) {
      throw new BadRequestException('No active demo bet found for this round');
    }

    const bet = JSON.parse(raw) as DemoBet;
    if (bet.cashedOut) {
      throw new BadRequestException('Demo bet already cashed out');
    }

    const payoutCents = Math.floor(bet.betAmountCents * currentMultiplier);

    bet.cashedOut = true;
    bet.cashedOutAt = currentMultiplier;
    bet.payoutCents = payoutCents;

    const wallet = await this.getOrCreateWallet(socketId);
    wallet.balanceCents += payoutCents;

    await Promise.all([
      this.redis.set(betKey, JSON.stringify(bet), 'EX', 3600),
      this.redis.set(
        this.walletKey(socketId),
        JSON.stringify(wallet),
        'EX',
        GAME.DEMO_WALLET_TTL_SECONDS,
      ),
    ]);

    this.logger.verbose('Demo bet cashed out', {
      socketId,
      roundId,
      multiplier: currentMultiplier,
      payoutCents,
    });

    return { bet, wallet };
  }

  /**
   * Called when a round crashes. Marks all uncashed demo bets as lost.
   */
  async settleDemoBets(roundId: string): Promise<void> {
    const pattern = this.roundBetsPattern(roundId);
    const keys = await this.redis.keys(pattern);

    if (keys.length === 0) return;

    const pipeline = this.redis.pipeline();
    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (!raw) continue;

      const bet = JSON.parse(raw) as DemoBet;
      if (!bet.cashedOut) {
        bet.cashedOut = true; // lost — no payout
        pipeline.set(key, JSON.stringify(bet), 'EX', 3600);
      }
    }
    await pipeline.exec();

    this.logger.verbose('Demo bets settled for crashed round', {
      roundId,
      settledCount: keys.length,
    });
  }

  async getDemoBet(socketId: string, roundId: string): Promise<DemoBet | null> {
    const raw = await this.redis.get(this.betKey(roundId, socketId));
    return raw ? (JSON.parse(raw) as DemoBet) : null;
  }

  /**
   * Returns all demo bets for the given round (for state hydration on connect).
   */
  async getDemoRoundBets(roundId: string): Promise<DemoBet[]> {
    const pattern = this.roundBetsPattern(roundId);
    const keys = await this.redis.keys(pattern);
    const results: DemoBet[] = [];

    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (!raw) continue;
      results.push(JSON.parse(raw) as DemoBet);
    }

    return results;
  }

  /**
   * Returns all demo bets for a round that have an auto-cashout target
   * at or below the given multiplier, and have not yet cashed out.
   * Each entry includes the socketId extracted from the Redis key.
   */
  async getAutoCashOutDemoBets(
    roundId: string,
    multiplier: number,
  ): Promise<Array<{ socketId: string; bet: DemoBet }>> {
    const pattern = this.roundBetsPattern(roundId);
    const keys = await this.redis.keys(pattern);
    const results: Array<{ socketId: string; bet: DemoBet }> = [];

    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (!raw) continue;
      const bet = JSON.parse(raw) as DemoBet;
      if (
        !bet.cashedOut &&
        bet.autoCashOutAt != null &&
        bet.autoCashOutAt <= multiplier
      ) {
        // Key format: demo:bet:{roundId}:{socketId}
        const socketId = key.split(':').slice(3).join(':');
        results.push({ socketId, bet });
      }
    }

    return results;
  }
}
