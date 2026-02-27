import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PageDto } from '@/core/pagination/dto/page.dto';
import { PageOptionsDto } from '@/core/pagination/dto/page-options.dto';
import { PaginationFactory } from '@/core/pagination/pagination.factory';
import { ContextLogger } from '@/infra/logger/services/context-logger.service';
import { GameBet } from '../entity/game-bet.entity';
import { GameBetStatus } from '../enum/game-bet-status.enum';

@Injectable()
export class GameBetRepository {
  constructor(
    @InjectRepository(GameBet)
    private readonly repo: Repository<GameBet>,
    protected readonly logger: ContextLogger,
    private readonly paginationFactory: PaginationFactory<GameBet>,
  ) {}

  findActiveByRoundAndUser(
    roundId: string,
    userId: string,
    isDemo = false,
  ): Promise<GameBet | null> {
    return this.repo.findOneBy({
      roundId,
      userId,
      isDemo,
      status: GameBetStatus.ACTIVE,
    });
  }

  findActiveBetsByRound(roundId: string): Promise<GameBet[]> {
    return this.repo.findBy({ roundId, status: GameBetStatus.ACTIVE });
  }

  async findByUserPaginated(
    userId: string,
    pageOptions: PageOptionsDto,
  ): Promise<PageDto<GameBet>> {
    const qb = this.repo
      .createQueryBuilder('game_bet')
      .where('game_bet.user_id = :userId', { userId });
    return this.paginationFactory.paginate(qb, pageOptions);
  }

  async findByRoundId(roundId: string): Promise<GameBet[]> {
    return this.repo.find({ where: { roundId }, relations: ['user'] });
  }

  create(data: Partial<GameBet>): GameBet {
    return this.repo.create(data);
  }

  save(bet: GameBet): Promise<GameBet>;
  save(bet: GameBet, manager: EntityManager): Promise<GameBet>;
  save(bet: GameBet, manager?: EntityManager): Promise<GameBet> {
    const repo = manager ? manager.getRepository(GameBet) : this.repo;
    return repo.save(bet);
  }

  /**
   * Bulk-mark all active bets in a round as LOST.
   * Uses the provided EntityManager for transaction safety.
   */
  async settleActiveBetsAsLost(
    roundId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(GameBet)
      .set({ status: GameBetStatus.LOST })
      .where('round_id = :roundId AND status = :status', {
        roundId,
        status: GameBetStatus.ACTIVE,
      })
      .execute();
  }
}
