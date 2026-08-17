import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { users } from '../../users/schema/user.schema.js';
import { createdAt, updatedAt, uuidPk } from '../../infra/db/columns.js';
import { TRANSACTION_TYPES } from '@firecracker/contracts';
import { gameBets } from './game-bet.schema.js';

/** The transaction kinds, from `@firecracker/contracts`. */
export {
  TRANSACTION_TYPES,
  WalletTransactionType,
} from '@firecracker/contracts';

/**
 * Two wallets per user: `isDemo=false` is real money, `isDemo=true` is the demo
 * balance every visitor gets. The unique index over the pair is what makes
 * `getOrCreate` safe to call from anywhere.
 */
export const wallets = sqliteTable(
  'wallet',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Current balance in cents. The debit is guarded so it cannot go negative. */
    balanceCents: integer('balance_cents').notNull().default(0),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('wallet_user_id_is_demo_index').on(table.userId, table.isDemo),
  ],
);

/**
 * The ledger. Every balance change writes one row carrying the balance *after* it,
 * so a disputed balance can be replayed rather than argued about.
 *
 * `stripePaymentIntentId` is gone with the billing module. Deposits are out of
 * scope for this build, so `DEPOSIT` currently has no writer - the type is kept
 * because the ledger's history still contains them and dropping the variant would
 * make old rows unreadable.
 */
export const walletTransactions = sqliteTable(
  'wallet_transaction',
  {
    id: uuidPk(),
    walletId: text('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    type: text('type', { enum: TRANSACTION_TYPES }).notNull(),
    /** Always positive. `type` carries the direction. */
    amountCents: integer('amount_cents').notNull(),
    /** Snapshot of the wallet balance after this row was written. */
    balanceAfterCents: integer('balance_after_cents').notNull(),
    gameBetId: text('game_bet_id').references(() => gameBets.id, {
      onDelete: 'set null',
    }),
    description: text('description'),
    createdAt: createdAt(),
  },
  (table) => [
    index('wallet_transaction_wallet_id_index').on(table.walletId),
    index('wallet_transaction_type_index').on(table.type),
  ],
);

export type WalletRow = typeof wallets.$inferSelect;
export type NewWalletRow = typeof wallets.$inferInsert;
export type WalletTransactionRow = typeof walletTransactions.$inferSelect;
export type NewWalletTransactionRow = typeof walletTransactions.$inferInsert;
