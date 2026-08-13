import { and, desc, eq } from 'drizzle-orm';
import { SyncDatabase } from '@dunx/infra/db';
import { paginate, type Page, type PageOptions } from '@dunx/infra/pagination';
import * as schema from '../../infra/db/schema.js';
import { asHandle, type DbHandle } from '../../infra/db/tx.js';
import { users, type UserRow } from '../../users/schema/user.schema.js';
import {
  gameBets,
  GameBetStatus,
  type GameBetRow,
  type NewGameBetRow,
} from '../schema/game-bet.schema.js';

/** A bet with the display name the lobby shows next to it. */
export interface BetWithPlayer extends GameBetRow {
  readonly playerName: string;
}

export class GameBetRepository {
  constructor(private readonly db: SyncDatabase<typeof schema>) {}

  /**
   * The same repository bound to a transaction handle, so a service can run its
   * reads and writes inside one. See `infra/db/tx.ts` for why the cast is there
   * and why it is in one place.
   */
  static over(handle: DbHandle): GameBetRepository {
    return new GameBetRepository(asHandle(handle));
  }

  findActiveByRoundAndUser(
    roundId: string,
    userId: string,
    isDemo: boolean,
  ): GameBetRow | undefined {
    return this.db
      .select()
      .from(gameBets)
      .where(
        and(
          eq(gameBets.roundId, roundId),
          eq(gameBets.userId, userId),
          eq(gameBets.isDemo, isDemo),
          eq(gameBets.status, GameBetStatus.ACTIVE),
        ),
      )
      .get();
  }

  findActiveByRound(roundId: string): GameBetRow[] {
    return this.db
      .select()
      .from(gameBets)
      .where(
        and(
          eq(gameBets.roundId, roundId),
          eq(gameBets.status, GameBetStatus.ACTIVE),
        ),
      )
      .all();
  }

  /**
   * Every bet in a round with its player's name, for the lobby list.
   *
   * One join rather than the N+1 the TypeORM version did through a `user` relation
   * on each row - this runs on every socket connect, so it is on the hot path for a
   * player opening the page mid-round.
   */
  findByRoundWithPlayers(roundId: string): BetWithPlayer[] {
    const rows = this.db
      .select({ bet: gameBets, user: users })
      .from(gameBets)
      .innerJoin(users, eq(gameBets.userId, users.id))
      .where(eq(gameBets.roundId, roundId))
      .all();

    return rows.map(({ bet, user }) => ({
      ...bet,
      playerName: displayName(user),
    }));
  }

  create(values: NewGameBetRow): GameBetRow {
    return this.db.insert(gameBets).values(values).returning().get();
  }

  update(
    id: string,
    values: { [K in keyof NewGameBetRow]?: NewGameBetRow[K] | undefined },
  ): GameBetRow | undefined {
    return this.db
      .update(gameBets)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(gameBets.id, id))
      .returning()
      .get();
  }

  /**
   * Everything still ACTIVE in a crashed round lost. One statement rather than a
   * row-by-row loop, because this runs inside the crash transaction while players
   * are watching.
   */
  settleActiveBetsAsLost(roundId: string): number {
    return this.db
      .update(gameBets)
      .set({ status: GameBetStatus.LOST, updatedAt: new Date() })
      .where(
        and(
          eq(gameBets.roundId, roundId),
          eq(gameBets.status, GameBetStatus.ACTIVE),
        ),
      )
      .returning()
      .all().length;
  }

  listByUser(userId: string, options: PageOptions): Promise<Page<GameBetRow>> {
    return paginate<typeof gameBets, GameBetRow>({
      db: this.db,
      table: gameBets,
      options,
      orderBy: 'createdAt',
      where: eq(gameBets.userId, userId),
    });
  }

  /** The player's most recent results, for the history panel. */
  recentByUser(userId: string, limit: number): GameBetRow[] {
    return this.db
      .select()
      .from(gameBets)
      .where(eq(gameBets.userId, userId))
      .orderBy(desc(gameBets.createdAt))
      .limit(limit)
      .all();
  }
}

/**
 * What the lobby calls a player. The email local-part is the fallback the NestJS
 * gateway used inline; it is here so the HTTP and socket paths cannot disagree
 * about what a given player is called.
 */
export const displayName = (user: Pick<UserRow, 'name' | 'email' | 'id'>) =>
  user.name || user.email.split('@')[0] || user.id;
