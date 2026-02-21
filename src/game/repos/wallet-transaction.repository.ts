import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PageDto } from '@/core/pagination/dto/page.dto';
import { PageOptionsDto } from '@/core/pagination/dto/page-options.dto';
import { PaginationFactory } from '@/core/pagination/pagination.factory';
import { ContextLogger } from '@/infra/logger/services/context-logger.service';
import { WalletTransaction } from '../entity/wallet-transaction.entity';

@Injectable()
export class WalletTransactionRepository {
  constructor(
    @InjectRepository(WalletTransaction)
    private readonly repo: Repository<WalletTransaction>,
    protected readonly logger: ContextLogger,
    private readonly paginationFactory: PaginationFactory<WalletTransaction>,
  ) {}

  async findByWalletIdPaginated(
    walletId: string,
    pageOptions: PageOptionsDto,
  ): Promise<PageDto<WalletTransaction>> {
    const qb = this.repo
      .createQueryBuilder('wallet_transaction')
      .where('wallet_transaction.wallet_id = :walletId', { walletId });
    return this.paginationFactory.paginate(qb, pageOptions);
  }

  create(data: Partial<WalletTransaction>): WalletTransaction {
    return this.repo.create(data);
  }

  save(txn: WalletTransaction): Promise<WalletTransaction>;
  save(
    txn: WalletTransaction,
    manager: EntityManager,
  ): Promise<WalletTransaction>;
  save(
    txn: WalletTransaction,
    manager?: EntityManager,
  ): Promise<WalletTransaction> {
    const repo = manager ? manager.getRepository(WalletTransaction) : this.repo;
    return repo.save(txn);
  }
}
