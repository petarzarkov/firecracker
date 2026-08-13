import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { SyncDatabase } from '@dunx/infra/db';
import { paginate, type Page, type PageOptions } from '@dunx/infra/pagination';
import * as schema from '../../infra/db/schema.js';
import { asHandle, type DbHandle } from '../../infra/db/tx.js';
import {
  gameRounds,
  GameRoundStatus,
  type GameRoundRow,
  type NewGameRoundRow,
} from '../schema/game-round.schema.js';

/**
 * Every method here is synchronous except `list`, which is the same split
 * `UsersRepository` documents: `bun:sqlite` returns rows rather than promises, and
 * `paginate` is async only because it serves `Bun.SQL` as well.
 *
 * The synchrony is not incidental in this module. `GameBetService` needs its
 * read-check-write to be one uninterruptible step, and it gets that for free
 * because none of these can yield.
 */
export class GameRoundRepository {
  constructor(private readonly db: SyncDatabase<typeof schema>) {}

  /**
   * The same repository bound to a transaction handle, so a service can run its
   * reads and writes inside one. See `infra/db/tx.ts` for why the cast is there
   * and why it is in one place.
   */
  static over(handle: DbHandle): GameRoundRepository {
    return new GameRoundRepository(asHandle(handle));
  }

  findById(id: string): GameRoundRow | undefined {
    return this.db.select().from(gameRounds).where(eq(gameRounds.id, id)).get();
  }

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

  create(values: NewGameRoundRow): GameRoundRow {
    return this.db.insert(gameRounds).values(values).returning().get();
  }

  update(
    id: string,
    values: { [K in keyof NewGameRoundRow]?: NewGameRoundRow[K] | undefined },
  ): GameRoundRow | undefined {
    return this.db
      .update(gameRounds)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(gameRounds.id, id))
      .returning()
      .get();
  }

  /**
   * A status transition that will not run twice.
   *
   * The `from` status is part of the `WHERE`, so two workers racing to crash the
   * same round produce one update and one `undefined`. The caller treats
   * `undefined` as "somebody else already did it" rather than as an error - which
   * is what makes the crash job safe to retry.
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

  list(options: PageOptions): Promise<Page<GameRoundRow>> {
    return paginate<typeof gameRounds, GameRoundRow>({
      db: this.db,
      table: gameRounds,
      options,
      orderBy: 'createdAt',
    });
  }
}
