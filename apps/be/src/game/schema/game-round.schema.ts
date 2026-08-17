import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { GameRoundStatus, ROUND_STATUSES } from '@firecracker/contracts';
import {
  createdAt,
  timestampMs,
  updatedAt,
  uuidPk,
} from '../../infra/db/columns.js';

/** The status values, from `@firecracker/contracts`. See the bet schema. */
export { GameRoundStatus, ROUND_STATUSES } from '@firecracker/contracts';

/**
 * One round of the crash game, and the provably-fair record for it.
 *
 * ## Multipliers are integer hundredths, not decimals
 *
 * `crashPointX100` is the one deliberate schema change in this migration.
 * Postgres held this as `decimal(10,2)`, which TypeORM handed back as a **string**,
 * so every read site in the old code said `Number(round.crashPoint)` - and every
 * comparison then happened in float64, where `1.07` is not `1.07`.
 *
 * SQLite has no decimal type at all, so the choice was `real` or an integer. An
 * integer count of hundredths is exact, and it lets the engine's
 * `multiplier >= crashPoint` test and the payout multiply both run in integer
 * space. A round that crashes at 1.07x stores `107`.
 *
 * The wire format is unchanged: clients still receive `1.07`. `toMultiplier()` in
 * `game.math.ts` is the only place that divides.
 */
export const gameRounds = sqliteTable(
  'game_round',
  {
    id: uuidPk(),

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
     * `SHA256(sorted(playerSeeds).join(':'))`, or the string `firecracker` when
     * nobody submitted one. Set at the transition to RUNNING and public from then
     * on, which is what makes the result depend on the players and not only on us.
     */
    clientSeed: text('client_seed'),

    /** Per-round counter, so a seed pair cannot produce the same point twice. */
    nonce: integer('nonce').notNull().default(0),

    /**
     * The `@arkv/rng` algorithm the crash point was drawn with.
     *
     * Stored per round rather than read from config at verification time, and that
     * is the whole point: the algorithm is part of the fairness contract. If the
     * default ever changes, every round written before the change still says how to
     * reproduce itself, and a verifier reads this column instead of guessing.
     */
    rngAlgorithm: text('rng_algorithm').notNull().default('pcg64'),

    /** The crash multiplier in hundredths. Secret until the crash. */
    crashPointX100: integer('crash_point_x100'),

    status: text('status', { enum: ROUND_STATUSES })
      .notNull()
      .default(GameRoundStatus.WAITING),

    /** When the betting window closes and the rocket launches. */
    waitingEndsAt: timestampMs('waiting_ends_at'),
    startedAt: timestampMs('started_at'),
    crashedAt: timestampMs('crashed_at'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
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
