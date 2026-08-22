import { Logger } from '@dunx/core';
import { SyncDatabase, transactionSync } from '@dunx/infra/db';
import type { Page, PageOptions } from '@dunx/infra/pagination';
import { AppConfigService } from '../../config/app.config.service.js';
import type { AppSchema, DbHandle } from '../../infra/db/tx.js';
import { WalletRepository } from '../repos/wallet.repository.js';
import {
  WalletTransactionType,
  type WalletRow,
  type WalletTransactionRow,
} from '../schema/wallet.schema.js';

/**
 * Balances and the ledger behind them, and the only wallet symbol anything outside
 * this module may name.
 *
 * Every method that moves money takes the caller's `DbHandle` as its **first and
 * required** argument and is **synchronous**. An optional handle would default to
 * the injected connection and commit the debit outside the bet it belongs to; an
 * `async` one would break the `transactionSync` callback that is standing in for a
 * lock - read-check-write is atomic only because it cannot yield.
 *
 * There is no funding path: a real wallet opens at zero, and `DEPOSIT` survives in
 * the enum only because old ledger rows carry it.
 */
export class WalletService {
  constructor(
    private readonly wallets: WalletRepository,
    /**
     * Only `resetDemoWallet` uses this, and it is why the reset is safe. Nothing
     * else here opens a transaction: the money methods take the caller's.
     */
    private readonly db: SyncDatabase<AppSchema>,
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

  /**
   * The wallet as the caller's transaction sees it. Unlike `getWallet` this does
   * not create one: a debit path that created the wallet it was about to draw on
   * would be opening an account mid-bet.
   */
  findWallet(
    tx: DbHandle,
    userId: string,
    isDemo: boolean,
  ): WalletRow | undefined {
    return WalletRepository.over(tx).findByUserId(userId, isDemo);
  }

  /**
   * Take money out, refusing rather than overdrawing. The guard is in the `UPDATE`'s
   * `WHERE` - see `WalletRepository.debit`. `undefined` means the funds were not
   * there and nothing was written.
   */
  debit(
    tx: DbHandle,
    walletId: string,
    amountCents: number,
    type: WalletTransactionType,
    description: string,
    gameBetId: string | null,
  ): WalletRow | undefined {
    const repo = WalletRepository.over(tx);
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
    tx: DbHandle,
    walletId: string,
    amountCents: number,
    type: WalletTransactionType,
    description: string,
    gameBetId: string | null,
  ): WalletRow {
    const repo = WalletRepository.over(tx);
    const updated = repo.credit(walletId, amountCents);
    if (updated === undefined) {
      // Loud rather than a silent skip: a credit that vanishes is money a player
      // is owed, and the row was read inside this same transaction.
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
  ): Page<WalletTransactionRow> {
    const wallet = this.getWallet(userId, isDemo);
    return this.wallets.listTransactions(wallet.id, options);
  }

  /**
   * Put a demo wallet back to its opening balance - the one funding path that
   * survives, because a demo balance is not money.
   *
   * The `transactionSync` is not ceremony: this writes a balance *and* a ledger
   * row, and an interruption between them leaves a balance change with no entry
   * explaining it. Safe to nest, since `bun:sqlite` takes a savepoint instead.
   */
  resetDemoWallet(userId: string): WalletRow {
    const wallet = this.getWallet(userId, true);
    const opening = this.config.get('game').demoInitialBalanceCents;
    const delta = opening - wallet.balanceCents;
    if (delta === 0) return wallet;

    const updated = transactionSync(this.db, (tx) =>
      delta > 0
        ? this.credit(
            tx,
            wallet.id,
            delta,
            WalletTransactionType.DEPOSIT,
            'Demo wallet reset',
            null,
          )
        : this.debit(
            tx,
            wallet.id,
            -delta,
            WalletTransactionType.WITHDRAWAL,
            'Demo wallet reset',
            null,
          ),
    );

    this.logger.debug('demo wallet reset', { userId, opening });
    return updated ?? wallet;
  }
}
