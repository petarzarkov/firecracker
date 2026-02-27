import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { GAME } from '@/constants';
import { ContextLogger } from '@/infra/logger/services/context-logger.service';
import { Wallet } from '../entity/wallet.entity';

@Injectable()
export class WalletRepository {
  constructor(
    @InjectRepository(Wallet)
    private readonly repo: Repository<Wallet>,
    protected readonly logger: ContextLogger,
  ) {}

  findByUserId(userId: string, isDemo = false): Promise<Wallet | null> {
    return this.repo.findOneBy({ userId, isDemo });
  }

  async getOrCreate(userId: string, isDemo = false): Promise<Wallet> {
    const existing = await this.findByUserId(userId, isDemo);
    if (existing) return existing;
    const wallet = this.repo.create({
      userId,
      isDemo,
      // Demo wallets are seeded with play money; real wallets start at zero
      balanceCents: isDemo ? GAME.DEMO_INITIAL_BALANCE_CENTS : 0,
    });
    return this.repo.save(wallet);
  }

  save(wallet: Wallet): Promise<Wallet> {
    return this.repo.save(wallet);
  }

  /**
   * Atomically credit the wallet balance.
   * Returns the updated wallet or null if not found.
   */
  async creditCents(
    walletId: string,
    amountCents: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(Wallet) : this.repo;
    await repo
      .createQueryBuilder()
      .update(Wallet)
      .set({ balanceCents: () => `balance_cents + ${amountCents}` })
      .where('id = :walletId', { walletId })
      .execute();
  }

  /**
   * Atomically debit the wallet balance.
   * The UPDATE only applies if `balance_cents >= amountCents`.
   * Returns the number of affected rows (0 means insufficient balance).
   */
  async debitCents(
    walletId: string,
    amountCents: number,
    manager?: EntityManager,
  ): Promise<number> {
    const repo = manager ? manager.getRepository(Wallet) : this.repo;
    const result = await repo
      .createQueryBuilder()
      .update(Wallet)
      .set({ balanceCents: () => `balance_cents - ${amountCents}` })
      .where('id = :walletId AND balance_cents >= :amountCents', {
        walletId,
        amountCents,
      })
      .execute();
    return result.affected ?? 0;
  }
}
