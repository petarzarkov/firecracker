import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PageDto } from '@/core/pagination/dto/page.dto';
import { PageOptionsDto } from '@/core/pagination/dto/page-options.dto';
import { PaginationFactory } from '@/core/pagination/pagination.factory';
import { ContextLogger } from '@/infra/logger/services/context-logger.service';
import { GameRound } from '../entity/game-round.entity';
import { GameRoundStatus } from '../enum/game-round-status.enum';

@Injectable()
export class GameRoundRepository {
  constructor(
    @InjectRepository(GameRound)
    private readonly repo: Repository<GameRound>,
    protected readonly logger: ContextLogger,
    private readonly paginationFactory: PaginationFactory<GameRound>,
  ) {}

  /**
   * Find the currently active round (WAITING or RUNNING).
   * At most one such round should exist at any time.
   */
  findCurrentRound(): Promise<GameRound | null> {
    return this.repo.findOne({
      where: { status: In([GameRoundStatus.WAITING, GameRoundStatus.RUNNING]) },
      order: { createdAt: 'DESC' },
    });
  }

  findById(id: string): Promise<GameRound | null> {
    return this.repo.findOneBy({ id });
  }

  findRecentCrashes(limit: number): Promise<GameRound[]> {
    return this.repo.find({
      where: { status: GameRoundStatus.CRASHED },
      order: { crashedAt: 'DESC' },
      take: limit,
      select: { id: true, crashPoint: true, crashedAt: true },
    });
  }

  async getRoundHistory(
    pageOptions: PageOptionsDto,
  ): Promise<PageDto<GameRound>> {
    const qb = this.repo
      .createQueryBuilder('game_round')
      .where('game_round.status = :status', {
        status: GameRoundStatus.CRASHED,
      });
    return this.paginationFactory.paginate(qb, pageOptions);
  }

  create(data: Partial<GameRound>): GameRound {
    return this.repo.create(data);
  }

  save(round: GameRound): Promise<GameRound> {
    return this.repo.save(round);
  }
}
