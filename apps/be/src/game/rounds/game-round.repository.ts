import type { Page, PageOptions } from '@dunx/infra/pagination';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { CrudRepository } from '../../infra/db/base.repository.js';
import {
  gameRounds,
  GameRoundStatus,
  type GameRoundRow,
  type NewGameRoundRow,
} from './game-round.schema.js';

export class GameRoundRepository extends CrudRepository<
  typeof gameRounds,
  GameRoundRow,
  NewGameRoundRow
> {
  protected readonly table = gameRounds;

  /**
   * The round the game is currently on: the newest that has not finished.
   *
   * `WAITING` or `RUNNING` only - a `CRASHED` or `FAILED` round is history. The
   * engine calls this at boot to work out what it was in the middle of when the
   * process last died.
   */
  findCurrentRound(): GameRoundRow | undefined {
    return this.db
      .select()
      .from(gameRounds)
      .where(
        inArray(gameRounds.status, [
          GameRoundStatus.WAITING,
          GameRoundStatus.RUNNING,
        ]),
      )
      .orderBy(desc(gameRounds.createdAt))
      .get();
  }

  /** The crash-history strip every client gets on connect. */
  findRecentCrashes(limit: number): GameRoundRow[] {
    return this.db
      .select()
      .from(gameRounds)
      .where(eq(gameRounds.status, GameRoundStatus.CRASHED))
      .orderBy(desc(gameRounds.createdAt))
      .limit(limit)
      .all();
  }

  /**
   * Rounds that have been sitting in a live status past the threshold. The cleanup
   * job fails these and refunds their bets.
   *
   * Both timestamps are checked because a round can stall in either phase, and a
   * `WAITING` round that never launched has a null `startedAt` - so filtering on
   * that column alone would never see it.
   */
  findStuckRounds(threshold: Date): GameRoundRow[] {
    return this.db
      .select()
      .from(gameRounds)
      .where(
        and(
          inArray(gameRounds.status, [
            GameRoundStatus.WAITING,
            GameRoundStatus.RUNNING,
          ]),
          or(
            lt(gameRounds.startedAt, threshold),
            and(
              eq(gameRounds.status, GameRoundStatus.WAITING),
              lt(gameRounds.createdAt, threshold),
            ),
          ),
        ),
      )
      .all();
  }

  /**
   * A status transition that will not run twice.
   *
   * The `from` status is part of the `WHERE`, so two workers racing to crash the
   * same round produce one update and one `undefined`. The caller treats
   * `undefined` as "somebody else already did it" rather than as an error - which
   * is what makes the crash job safe to retry. Not `update` with extra arguments:
   * the guard is the point, and the base's `update` cannot express it.
   */
  transition(
    id: string,
    from: GameRoundStatus,
    values: { [K in keyof NewGameRoundRow]?: NewGameRoundRow[K] | undefined },
  ): GameRoundRow | undefined {
    return this.db
      .update(gameRounds)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(gameRounds.id, id), eq(gameRounds.status, from)))
      .returning()
      .get();
  }

  list(options: PageOptions): Page<GameRoundRow> {
    return this.page(options);
  }

  /**
   * Deletes finished rounds beyond the newest `keep`, and answers how many went.
   *
   * **Bets go with them**, through `game_bet.round_id`'s `onDelete: 'cascade'`.
   * That cascade only runs because `sqlite.ts` sets `foreign_keys = ON`; SQLite
   * defaults it off, and with it off this would leave bets pointing at rounds
   * that no longer exist.
   *
   * Terminal statuses only, so a `WAITING` or `RUNNING` round is never deleted
   * out from under the engine. The live round is the newest and inside `keep`
   * anyway; this is the guard for the case where it is not.
   *
   * The cutoff is the `keep`-th newest row's timestamp rather than an offset in
   * the delete, which SQLite cannot express. Rounds sharing that timestamp are
   * all kept, so the error is always in the direction of keeping more.
   *
   * **Counted by `returning()` rather than by `changes`.** `bun:sqlite` reports
   * cascaded rows in `changes`, so a delete of one round carrying one bet answers
   * 2 - measured. This has to be rounds, because it is what the log line says.
   */
  pruneToNewest(keep: number): number {
    const cutoff = this.db
      .select({ createdAt: gameRounds.createdAt })
      .from(gameRounds)
      .orderBy(desc(gameRounds.createdAt))
      .limit(1)
      .offset(keep - 1)
      .get();

    // Fewer rounds than the window: nothing is outside it.
    if (cutoff === undefined) return 0;

    return this.db
      .delete(gameRounds)
      .where(
        and(
          lt(gameRounds.createdAt, cutoff.createdAt),
          inArray(gameRounds.status, [
            GameRoundStatus.CRASHED,
            GameRoundStatus.FAILED,
          ]),
        ),
      )
      .returning({ id: gameRounds.id })
      .all().length;
  }
}
