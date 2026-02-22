import { createHmac, randomBytes } from 'node:crypto';
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
import { GameRound } from '../entity/game-round.entity';
import { GameRoundStatus } from '../enum/game-round-status.enum';
import { GameRoundRepository } from '../repos/game-round.repository';
import { GameBetService } from './game-bet.service';

@Injectable()
export class GameRoundService {
  constructor(
    private readonly gameRoundRepo: GameRoundRepository,
    private readonly gameBetService: GameBetService,
    private readonly dataSource: DataSource,
    private readonly logger: ContextLogger,
  ) {}

  /**
   * Generates a provably fair crash point from a seed.
   * Uses the BC.Game / Bustabit provably fair algorithm:
   *   ~3% instant crash (1.00x) via h % 33 === 0 (house edge)
   *   ~50% of rounds crash below 2x
   *   P(crash ≥ x) ≈ 0.99 / x
   */
  generateCrashPoint(seed: string): number {
    const hash = createHmac('sha256', seed).digest('hex');
    const h = parseInt(hash.slice(0, 13), 16);
    const e = 2 ** 52;
    if (h % 33 === 0) return 1.0; // ~3% instant crash (house edge)
    return Math.max(1.0, Math.floor((99 * e) / (e - h)) / 100);
  }

  generateSeed(): string {
    return randomBytes(32).toString('hex');
  }

  generateSeedHash(seed: string): string {
    return createHmac('sha256', seed).update('firecracker').digest('hex');
  }

  /**
   * Creates a new round in WAITING state with a pre-committed crash point.
   * The crash point is hidden from clients until the round ends.
   */
  async createNextRound(): Promise<GameRound> {
    const seed = this.generateSeed();
    const seedHash = this.generateSeedHash(seed);
    const crashPoint = this.generateCrashPoint(seed);
    const waitingEndsAt = new Date(Date.now() + GAME.WAITING_PHASE_MS);

    const round = this.gameRoundRepo.create({
      seed,
      seedHash,
      crashPoint,
      status: GameRoundStatus.WAITING,
      waitingEndsAt,
    });

    const saved = await this.gameRoundRepo.save(round);

    this.logger.log('New game round created', {
      roundId: saved.id,
      waitingEndsAt,
      crashPoint,
    });

    return saved;
  }

  /**
   * Transitions a round from WAITING → RUNNING.
   * Idempotent: returns silently if round is already RUNNING.
   */
  async transitionToRunning(roundId: string): Promise<GameRound> {
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

    round.status = GameRoundStatus.RUNNING;
    round.startedAt = new Date();

    return this.gameRoundRepo.save(round);
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
