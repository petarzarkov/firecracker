import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { GameRoundStatus, ROUND_STATUSES } from '@firecracker/contracts';
import { Columns } from '../../infra/db/columns.js';

/** The status values, from `@firecracker/contracts`. See the bet schema. */
export { GameRoundStatus, ROUND_STATUSES } from '@firecracker/contracts';

/**
 * One round of the crash game, and the provably-fair record for it.
 *
 * **Multipliers are integer hundredths, never a float**: SQLite has no decimal type,
 * and a `real` puts every `multiplier >= crashPoint` test in float64 where `1.07` is
 * not `1.07`. A round crashing at 1.07x stores `107`; `toMultiplier()` is the only
 * place that divides.
 */
export const gameRounds = sqliteTable(
  'game_round',
  {
    id: Columns.uuidPk(),

    /**
     * Server seed the crash point is derived from. Never sent to a client until
     * the round has crashed - that is the whole of "provably fair".
     */
    seed: text('seed').notNull(),

    /**
     * `SHA256(seed)`, published *before* the round starts, so a player can check
     * afterwards that the seed was not chosen to suit the outcome.
     */
    seedHash: text('seed_hash').notNull(),

    /**
     * `SHA256(sorted(playerSeeds).join(':'))`, or `firecracker` when nobody
     * submitted one. Written at the transition to RUNNING and public from then on -
     * it is what makes the result depend on the players and not only on us.
     */
    clientSeed: text('client_seed'),

    /** Per-round counter, so a seed pair cannot produce the same point twice. */
    nonce: integer('nonce').notNull().default(0),

    /**
     * Per round rather than read from config at verification time: the algorithm is
     * part of the fairness contract, so changing the default must not stop an older
     * round saying how to reproduce itself.
     */
    rngAlgorithm: text('rng_algorithm').notNull().default('pcg64'),

    /** The crash multiplier in hundredths. Secret until the crash. */
    crashPointX100: integer('crash_point_x100'),

    status: text('status', { enum: ROUND_STATUSES })
      .notNull()
      .default(GameRoundStatus.WAITING),

    /** When the betting window closes and the rocket launches. */
    waitingEndsAt: Columns.timestampMs('waiting_ends_at'),
    startedAt: Columns.timestampMs('started_at'),
    crashedAt: Columns.timestampMs('crashed_at'),

    createdAt: Columns.createdAt(),
    updatedAt: Columns.updatedAt(),
  },
  (table) => [
    // `findCurrentRound` filters on status and takes the newest, and the recent
    // crash strip orders by creation. Both are hot on every socket connect.
    index('game_round_status_index').on(table.status),
    index('game_round_created_at_index').on(table.createdAt),
  ],
);

export type GameRoundRow = typeof gameRounds.$inferSelect;
export type NewGameRoundRow = typeof gameRounds.$inferInsert;
