import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { SyncDatabase } from '@dunx/infra/db';
import { paginate, type Page, type PageOptions } from '@dunx/infra/pagination';
import * as schema from '../../infra/db/schema.js';
import { Tx, type DbHandle } from '../../infra/db/tx.js';
import {
  wallets,
  walletTransactions,
  type NewWalletTransactionRow,
  type WalletRow,
  type WalletTransactionRow,
} from '../schema/wallet.schema.js';

export class WalletRepository {
  constructor(private readonly db: SyncDatabase<typeof schema>) {}

  /**
   * The same repository bound to a transaction handle, so a service can run its
   * reads and writes inside one. See `infra/db/tx.ts` for why the cast is there
   * and why it is in one place.
   */
  static over(handle: DbHandle): WalletRepository {
    return new WalletRepository(Tx.asHandle(handle));
  }

  findByUserId(userId: string, isDemo: boolean): WalletRow | undefined {
    return this.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.isDemo, isDemo)))
      .get();
  }

  findById(id: string): WalletRow | undefined {
    return this.db.select().from(wallets).where(eq(wallets.id, id)).get();
  }

  /**
   * The wallet, created at the opening balance if this is the first time we have
   * seen this user in this mode.
   *
   * `onConflictDoNothing` against `wallet_user_id_is_demo_index` rather than a
   * check-then-insert: two sockets opening at once would both pass the check, and
   * the loser would get a unique-constraint error on a read path.
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
   * Take `amountCents` off the balance, but only if it is there.
   *
   * The `gte` in the `WHERE` is the overdraft guard, and it is in the statement on
   * purpose: a balance check in JavaScript followed by an update is two steps, and
   * the guarantee has to hold against the *other process* as well as this one.
   * Returns the updated row, or `undefined` when the funds were not there.
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

  listTransactions(
    walletId: string,
    options: PageOptions,
  ): Promise<Page<WalletTransactionRow>> {
    return paginate<typeof walletTransactions, WalletTransactionRow>({
      db: this.db,
      table: walletTransactions,
      options,
      orderBy: 'createdAt',
      where: eq(walletTransactions.walletId, walletId),
    });
  }
}
