import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GAME } from '@/constants';
import { PageDto } from '@/core/pagination/dto/page.dto';
import { PageOptionsDto } from '@/core/pagination/dto/page-options.dto';
import { ContextLogger } from '@/infra/logger/services/context-logger.service';
import { RedisService } from '@/infra/redis/services/redis.service';
import { GameRound } from '../entity/game-round.entity';
import { GameRoundStatus } from '../enum/game-round-status.enum';
import { GameRoundRepository } from '../repos/game-round.repository';
import { GameBetService } from './game-bet.service';

const NONCE_KEY = 'game:round:nonce';

@Injectable()
export class GameRoundService {
  private readonly redis;

  constructor(
    private readonly gameRoundRepo: GameRoundRepository,
    private readonly gameBetService: GameBetService,
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
    private readonly logger: ContextLogger,
  ) {
    this.redis = this.redisService.newConnection('game-round-service');
  }

  /**
   * Generates a provably fair crash point using HMAC-SHA256.
   * key = serverSeed, message = clientSeed:nonce
   *
   * Uses the BC.Game / Bustabit provably fair algorithm:
   *   ~3% instant crash (1.00x) via h % 33 === 0 (house edge)
   *   ~50% of rounds crash below 2x
   *   P(crash ≥ x) ≈ 0.99 / x
   */
  generateCrashPoint(
    serverSeed: string,
    clientSeed: string,
    nonce: number,
  ): number {
    const hasher = new Bun.CryptoHasher('sha256', serverSeed);
    hasher.update(`${clientSeed}:${nonce}`);
    const hash = hasher.digest('hex');
    const h = parseInt(hash.slice(0, 13), 16);
    const e = 2 ** 52;
    if (h % 33 === 0) return 1.0; // ~3% instant crash (house edge)
    return Math.max(1.0, Math.floor((99 * e) / (e - h)) / 100);
  }

  /** 32 cryptographically random bytes using the Web Crypto API (Bun global). */
  generateSeed(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString('hex');
  }

  /**
   * SHA256 commitment hash — published to clients before the round starts
   * so they can verify the server seed was not changed after commitment.
   */
  generateSeedHash(seed: string): string {
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(seed);
    return hasher.digest('hex');
  }

  /**
   * Combines all player-submitted seeds into a single deterministic value.
   * Seeds are sorted lexicographically then SHA256-hashed so the result
   * is independent of submission order.
   * Falls back to "firecracker" when no seeds were submitted.
   */
  combineClientSeeds(seeds: string[]): string {
    if (seeds.length === 0) return 'firecracker';
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(seeds.sort().join(':'));
    return hasher.digest('hex');
  }

  /** Atomically increments and returns the per-round nonce counter. */
  async nextNonce(): Promise<number> {
    return this.redis.incr(NONCE_KEY);
  }

  /**
   * Creates a new round in WAITING state.
   * The crashPoint is NOT yet computed — it is determined at transitionToRunning()
   * after client seeds are collected, ensuring true player influence on the result.
   */
  async createNextRound(): Promise<GameRound> {
    const seed = this.generateSeed();
    const seedHash = this.generateSeedHash(seed);
    const nonce = await this.nextNonce();
    const waitingEndsAt = new Date(Date.now() + GAME.WAITING_PHASE_MS);

    const round = this.gameRoundRepo.create({
      seed,
      seedHash,
      nonce,
      clientSeed: null,
      crashPoint: null,
      status: GameRoundStatus.WAITING,
      waitingEndsAt,
    });

    const saved = await this.gameRoundRepo.save(round);

    this.logger.log('New game round created', {
      roundId: saved.id,
      waitingEndsAt,
      nonce,
    });

    return saved;
  }

  /**
   * Transitions a round from WAITING → RUNNING.
   * Combines the provided client seeds, computes the crash point from
   * HMAC-SHA256(serverSeed, combinedClientSeed:nonce), and persists both
   * before changing status — ensuring the outcome is cryptographically
   * committed and verifiable.
   *
   * Idempotent: returns silently if round is already RUNNING.
   */
  async transitionToRunning(
    roundId: string,
    playerSeeds: string[] = [],
  ): Promise<GameRound> {
    const round = await this.gameRoundRepo.findById(roundId);
    if (!round) throw new NotFoundException(`Round ${roundId} not found`);

    if (round.status === GameRoundStatus.RUNNING) {
      this.logger.warn('Round already RUNNING — skipping transition', {
        roundId,
      });
      return round;
    }

    if (round.status !== GameRoundStatus.WAITING) {
      throw new BadRequestException(
        `Cannot start round in status: ${round.status}`,
      );
    }

    const clientSeed = this.combineClientSeeds(playerSeeds);
    const crashPoint = this.generateCrashPoint(
      round.seed,
      clientSeed,
      round.nonce,
    );

    round.clientSeed = clientSeed;
    round.crashPoint = crashPoint;
    round.status = GameRoundStatus.RUNNING;
    round.startedAt = new Date();

    const saved = await this.gameRoundRepo.save(round);

    this.logger.log('Round transitioned to RUNNING', {
      roundId,
      nonce: round.nonce,
      clientSeed,
      crashPoint,
    });

    return saved;
  }

  /**
   * Transitions a round from RUNNING → CRASHED and settles all active bets.
   * Idempotent: returns silently if round is already CRASHED.
   */
  async transitionToCrashed(roundId: string): Promise<GameRound> {
    const round = await this.gameRoundRepo.findById(roundId);
    if (!round) throw new NotFoundException(`Round ${roundId} not found`);

    if (round.status === GameRoundStatus.CRASHED) {
      this.logger.warn('Round already CRASHED — skipping transition', {
        roundId,
      });
      return round;
    }

    if (round.status !== GameRoundStatus.RUNNING) {
      throw new BadRequestException(
        `Cannot crash round in status: ${round.status}`,
      );
    }

    await this.dataSource.transaction(async manager => {
      round.status = GameRoundStatus.CRASHED;
      round.crashedAt = new Date();

      await manager.save(round);
      await this.gameBetService.settleAllBets(roundId, manager);
    });

    this.logger.log('Round crashed and bets settled', {
      roundId,
      crashPoint: round.crashPoint,
    });

    return round;
  }

  /**
   * Transitions a WAITING or RUNNING round to FAILED and refunds all active bets.
   * Idempotent: already FAILED → returns immediately with empty refunds.
   */
  async transitionToFailed(roundId: string): Promise<{
    round: GameRound;
    refunds: Array<{ userId: string; isDemo: boolean; balanceCents: number }>;
  }> {
    const round = await this.gameRoundRepo.findById(roundId);
    if (!round) throw new NotFoundException(`Round ${roundId} not found`);

    if (round.status === GameRoundStatus.FAILED) {
      return { round, refunds: [] };
    }

    if (
      round.status !== GameRoundStatus.WAITING &&
      round.status !== GameRoundStatus.RUNNING
    ) {
      throw new BadRequestException(
        `Cannot fail round in status: ${round.status}`,
      );
    }

    let refunds: Array<{
      userId: string;
      isDemo: boolean;
      balanceCents: number;
    }> = [];

    await this.dataSource.transaction(async manager => {
      round.status = GameRoundStatus.FAILED;
      await manager.save(round);
      refunds = await this.gameBetService.refundBetsForRound(roundId, manager);
    });

    this.logger.warn('Round transitioned to FAILED', {
      roundId,
      refundCount: refunds.length,
    });

    return { round, refunds };
  }

  getCurrentRound(): Promise<GameRound | null> {
    return this.gameRoundRepo.findCurrentRound();
  }

  getRecentCrashes(limit = 15): Promise<GameRound[]> {
    return this.gameRoundRepo.findRecentCrashes(limit);
  }

  findById(id: string): Promise<GameRound | null> {
    return this.gameRoundRepo.findById(id);
  }

  getRoundHistory(pageOptions: PageOptionsDto): Promise<PageDto<GameRound>> {
    return this.gameRoundRepo.getRoundHistory(pageOptions);
  }
}
