import { paginate, type Page, type PageOptions } from '@dunx/infra/pagination';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { BaseRepository } from '../../infra/db/base.repository.js';
import {
  wallets,
  walletTransactions,
  type NewWalletTransactionRow,
  type WalletRow,
  type WalletTransactionRow,
} from '../schema/wallet.schema.js';

/**
 * `BaseRepository`, not `CrudRepository` - an invariant rather than an omission. The
 * write tier's `update(id, values)` would accept `{ balanceCents: n }`, which is
 * exactly the JavaScript balance write `debit`'s `WHERE` exists to make
 * unexpressible.
 */
export class WalletRepository extends BaseRepository<
  typeof wallets,
  WalletRow
> {
  protected readonly table = wallets;

  findByUserId(userId: string, isDemo: boolean): WalletRow | undefined {
    return this.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.isDemo, isDemo)))
      .get();
  }

  /**
   * `onConflictDoNothing` rather than check-then-insert: two sockets opening at once
   * would both pass the check, and the loser would get a unique-constraint error on
   * a read path.
   */
  getOrCreate(
    userId: string,
    isDemo: boolean,
    openingBalanceCents: number,
  ): WalletRow {
    const existing = this.findByUserId(userId, isDemo);
    if (existing !== undefined) return existing;

    this.db
      .insert(wallets)
      .values({
        userId,
        isDemo,
        balanceCents: isDemo ? openingBalanceCents : 0,
      })
      .onConflictDoNothing()
      .run();

    // Re-read rather than trusting `returning()`: with `onConflictDoNothing` a
    // losing insert returns no row, and the row we want is the winner's.
    const wallet = this.findByUserId(userId, isDemo);
    if (wallet === undefined) {
      throw new Error(
        `wallet for user ${userId} (demo=${isDemo}) could not be created`,
      );
    }
    return wallet;
  }

  /**
   * The `gte` in the `WHERE` is the overdraft guard, and it is in the statement on
   * purpose: a JavaScript check followed by an update is two steps, and the
   * guarantee has to hold against the *other process*. `undefined` means no funds.
   */
  debit(walletId: string, amountCents: number): WalletRow | undefined {
    return this.db
      .update(wallets)
      .set({
        balanceCents: sql`${wallets.balanceCents} - ${amountCents}`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(wallets.id, walletId), gte(wallets.balanceCents, amountCents)),
      )
      .returning()
      .get();
  }

  credit(walletId: string, amountCents: number): WalletRow | undefined {
    return this.db
      .update(wallets)
      .set({
        balanceCents: sql`${wallets.balanceCents} + ${amountCents}`,
        updatedAt: new Date(),
      })
      .where(eq(wallets.id, walletId))
      .returning()
      .get();
  }

  recordTransaction(values: NewWalletTransactionRow): WalletTransactionRow {
    return this.db.insert(walletTransactions).values(values).returning().get();
  }

  recentTransactions(walletId: string, limit: number): WalletTransactionRow[] {
    return this.db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.walletId, walletId))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(limit)
      .all();
  }

  /**
   * The one paginated read that cannot go through `page()`: it walks
   * `wallet_transaction`, and the base's helper is over the repository's own
   * table. A second repository for the ledger would be a class for one query.
   */
  listTransactions(
    walletId: string,
    options: PageOptions,
  ): Page<WalletTransactionRow> {
    return paginate<typeof walletTransactions, WalletTransactionRow>({
      db: this.db,
      table: walletTransactions,
      options,
      orderBy: 'createdAt',
      where: eq(walletTransactions.walletId, walletId),
    });
  }
}
