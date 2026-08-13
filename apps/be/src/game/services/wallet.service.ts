import { Logger } from '@dunx/core';
import type { Page, PageOptions } from '@dunx/infra/pagination';
import { AppConfigService } from '../../config/app.config.service.js';
import type { DbHandle } from '../../infra/db/tx.js';
import { WalletRepository } from '../repos/wallet.repository.js';
import {
  WalletTransactionType,
  type WalletRow,
  type WalletTransactionRow,
} from '../schema/wallet.schema.js';

/**
 * Balances and the ledger behind them.
 *
 * ## What left with the billing module
 *
 * The Postgres version constructed a `Stripe` client in this constructor and
 * carried `deposit`, `withdraw` and a webhook handler. Billing is out of scope for
 * this build, so there is no funding path: a real wallet opens at zero and stays
 * there until one is added back, and the demo wallet is where the game is actually
 * played. `WalletTransactionType.DEPOSIT` survives in the enum because old ledger
 * rows still carry it - see the note on the schema.
 *
 * Every mutation here is synchronous and every one writes a ledger row beside it.
 * Neither is decoration: the sync path is what lets `GameBetService` wrap a debit
 * and an insert in one uninterruptible transaction, and the ledger is what makes a
 * disputed balance replayable instead of arguable.
 */
export class WalletService {
  constructor(
    private readonly wallets: WalletRepository,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  /**
   * The player's wallet, created at the opening balance the first time it is
   * asked for. A demo wallet opens at `GAME_DEMO_INITIAL_BALANCE_CENTS`; a real
   * one opens empty.
   */
  getWallet(userId: string, isDemo = false): WalletRow {
    return this.wallets.getOrCreate(
      userId,
      isDemo,
      this.config.get('game').demoInitialBalanceCents,
    );
  }

  getBalanceCents(userId: string, isDemo = false): number {
    return this.getWallet(userId, isDemo).balanceCents;
  }

  /**
   * Take money out, refusing rather than overdrawing.
   *
   * The guard is in the `UPDATE`'s `WHERE`, not here - see `WalletRepository.debit`
   * for why a JavaScript balance check would not hold against the other process.
   * Returns `undefined` when the funds were not there, and writes nothing.
   */
  debit(
    walletId: string,
    amountCents: number,
    type: WalletTransactionType,
    description: string,
    gameBetId: string | null,
    repo: WalletRepository = this.wallets,
  ): WalletRow | undefined {
    const updated = repo.debit(walletId, amountCents);
    if (updated === undefined) return undefined;

    repo.recordTransaction({
      walletId,
      type,
      amountCents,
      balanceAfterCents: updated.balanceCents,
      gameBetId,
      description,
    });
    return updated;
  }

  credit(
    walletId: string,
    amountCents: number,
    type: WalletTransactionType,
    description: string,
    gameBetId: string | null,
    repo: WalletRepository = this.wallets,
  ): WalletRow {
    const updated = repo.credit(walletId, amountCents);
    if (updated === undefined) {
      // The wallet was read inside the same transaction, so this cannot happen
      // without the row having been deleted underneath us. Loud rather than a
      // silent skip: a credit that vanishes is money a player is owed.
      throw new Error(`wallet ${walletId} disappeared during a credit`);
    }

    repo.recordTransaction({
      walletId,
      type,
      amountCents,
      balanceAfterCents: updated.balanceCents,
      gameBetId,
      description,
    });
    return updated;
  }

  recentTransactions(
    userId: string,
    isDemo: boolean,
    limit = 20,
  ): WalletTransactionRow[] {
    const wallet = this.getWallet(userId, isDemo);
    return this.wallets.recentTransactions(wallet.id, limit);
  }

  listTransactions(
    userId: string,
    isDemo: boolean,
    options: PageOptions,
  ): Promise<Page<WalletTransactionRow>> {
    const wallet = this.getWallet(userId, isDemo);
    return this.wallets.listTransactions(wallet.id, options);
  }

  /**
   * Put a demo wallet back to its opening balance. The one funding path that
   * survives, because a demo balance is not money.
   */
  resetDemoWallet(userId: string): WalletRow {
    const wallet = this.getWallet(userId, true);
    const opening = this.config.get('game').demoInitialBalanceCents;
    const delta = opening - wallet.balanceCents;
    if (delta === 0) return wallet;

    const updated =
      delta > 0
        ? this.credit(
            wallet.id,
            delta,
            WalletTransactionType.DEPOSIT,
            'Demo wallet reset',
            null,
          )
        : this.debit(
            wallet.id,
            -delta,
            WalletTransactionType.WITHDRAWAL,
            'Demo wallet reset',
            null,
          );

    this.logger.info('demo wallet reset', { userId, opening });
    return updated ?? wallet;
  }

  /** A repository bound to a transaction handle, for use inside one. */
  scoped(tx: DbHandle): WalletRepository {
    return WalletRepository.over(tx);
  }
}
