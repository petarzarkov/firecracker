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
 * Balances and the ledger behind them.
 *
 * ## The seam
 *
 * This class is the only wallet symbol anything outside this module may name. The
 * game imports no `WalletRepository`, no `wallets` table and no `WalletRow` -
 * which is what makes the guard below unroutable-around rather than merely
 * documented.
 *
 * Every method that moves money takes the caller's transaction handle as its
 * **first and required** argument, and is **synchronous**. Both halves are
 * load-bearing:
 *
 *  - **Required, and first.** Money moves only inside somebody's transaction, and
 *    an optional handle is how that stops being true - the default quietly becomes
 *    the injected connection and the debit commits on its own, outside the bet it
 *    belongs to. This replaced a trailing `repo: WalletRepository = this.wallets`,
 *    which was exactly that default.
 *  - **Synchronous.** `GameBetService` calls three of these between the first and
 *    last statement of a `transactionSync` callback, whose return type refuses a
 *    promise. That refusal is the whole of what replaced
 *    `pg_try_advisory_xact_lock`: read-check-write cannot interleave because it
 *    cannot yield. An `async` method here would remove that guarantee without
 *    breaking a single test.
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
 * Every mutation writes a ledger row beside it, which is what makes a disputed
 * balance replayable instead of arguable.
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

  getBalanceCents(userId: string, isDemo = false): number {
    return this.getWallet(userId, isDemo).balanceCents;
  }

  /**
   * The wallet as the caller's transaction sees it.
   *
   * Not `getWallet`: this one does not create. A debit path that created the
   * wallet it was about to draw on would be opening an account mid-bet, and the
   * caller has a player-facing message for the absence.
   */
  findWallet(
    tx: DbHandle,
    userId: string,
    isDemo: boolean,
  ): WalletRow | undefined {
    return WalletRepository.over(tx).findByUserId(userId, isDemo);
  }

  /**
   * Take money out, refusing rather than overdrawing.
   *
   * The guard is in the `UPDATE`'s `WHERE`, not here - see `WalletRepository.debit`
   * for why a JavaScript balance check would not hold against the other process.
   * Returns `undefined` when the funds were not there, and writes nothing.
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
  ): Page<WalletTransactionRow> {
    const wallet = this.getWallet(userId, isDemo);
    return this.wallets.listTransactions(wallet.id, options);
  }

  /**
   * Put a demo wallet back to its opening balance. The one funding path that
   * survives, because a demo balance is not money.
   *
   * The `transactionSync` is not ceremony for a handle the methods now demand: the
   * reset writes a balance *and* a ledger row, and before this it wrote them with
   * nothing around them - so an interruption between the two left a balance change
   * with no entry explaining it, in the one table that exists to explain balance
   * changes. Nesting is safe if a caller ever wraps this, because `bun:sqlite`
   * branches on `Database.inTransaction` and takes a savepoint instead.
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
