import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { users } from '../../users/schema/user.schema.js';
import { Columns } from '../../infra/db/columns.js';
import { BET_STATUSES, GameBetStatus } from '@firecracker/contracts';
import { gameRounds } from './game-round.schema.js';

/**
 * The status values, from `@firecracker/contracts` - the same declaration the
 * client renders from, so a status the database can hold is a status the browser
 * has a branch for.
 */
export { BET_STATUSES, GameBetStatus } from '@firecracker/contracts';

/**
 * One player's stake in one round.
 *
 * ## The unique index is now load-bearing
 *
 * `game_bet_round_user_demo_index` existed in the Postgres schema too, but it was
 * belt-and-braces behind a `pg_try_advisory_xact_lock` the bet path took first.
 * There is no advisory lock in SQLite and there no longer needs to be - a
 * `bun:sqlite` transaction is synchronous, so a double-bet cannot interleave
 * inside one process - but this index is what refuses the second bet when the two
 * arrive on **different** processes, which the lock used to cover.
 *
 * So a `SQLITE_CONSTRAINT_UNIQUE` here is not a bug, it is the duplicate check
 * firing. `GameBetService.placeBet` catches it and answers "you already have an
 * active bet in this round".
 */
export const gameBets = sqliteTable(
  'game_bet',
  {
    id: Columns.uuidPk(),

    roundId: text('round_id')
      .notNull()
      .references(() => gameRounds.id, { onDelete: 'cascade' }),

    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Stake in cents. 500 is $5.00. */
    betAmountCents: integer('bet_amount_cents').notNull(),

    /**
     * The multiplier the player cashed out at, in hundredths. Null means they did
     * not get out in time. See `gameRounds.crashPointX100` for why hundredths.
     */
    cashedOutAtX100: integer('cashed_out_at_x100'),

    /** `floor(betAmountCents * cashedOutAtX100 / 100)`. Null if the bet was lost. */
    payoutCents: integer('payout_cents'),

    status: text('status', { enum: BET_STATUSES })
      .notNull()
      .default(GameBetStatus.ACTIVE),

    /**
     * A demo bet is backed by the demo wallet. Everything else about it - the
     * settlement path, the payout arithmetic, the broadcast - is identical, which
     * is deliberate: the demo mode is the real game with different money.
     */
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),

    createdAt: Columns.createdAt(),
    updatedAt: Columns.updatedAt(),
  },
  (table) => [
    index('game_bet_round_id_index').on(table.roundId),
    index('game_bet_user_id_index').on(table.userId),
    index('game_bet_status_index').on(table.status),
    uniqueIndex('game_bet_round_user_demo_index').on(
      table.roundId,
      table.userId,
      table.isDemo,
    ),
  ],
);

export type GameBetRow = typeof gameBets.$inferSelect;
export type NewGameBetRow = typeof gameBets.$inferInsert;
