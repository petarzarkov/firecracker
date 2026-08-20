import type { Page, PageOptions } from '@dunx/infra/pagination';
import { and, desc, eq } from 'drizzle-orm';
import { CrudRepository } from '../../infra/db/base.repository.js';
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

export class GameBetRepository extends CrudRepository<
  typeof gameBets,
  GameBetRow,
  NewGameBetRow
> {
  /**
   * What the lobby calls a player. The email local-part is the fallback the NestJS
   * gateway used inline; it is here so the HTTP and socket paths cannot disagree
   * about what a given player is called.
   */
  static displayName(user: Pick<UserRow, 'name' | 'email' | 'id'>): string {
    return user.name || user.email.split('@')[0] || user.id;
  }

  protected readonly table = gameBets;

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

  /**
   * The player's open bet in this round, whichever wallet it is against.
   *
   * A cash-out should not need the client to say which mode it is in. The old
   * gateway kept `client.data.isDemo` on the socket and read it back, which broke
   * across a reconnect and disagreed with the database whenever the two drifted;
   * the bet row already knows, so this asks it.
   *
   * A player *can* hold one bet per mode in a round - the unique index is per
   * mode - so this returns the newest, and the caller may still pass an explicit
   * mode to disambiguate.
   */
  findActiveByRoundAndUserAnyMode(
    roundId: string,
    userId: string,
  ): GameBetRow | undefined {
    return this.db
      .select()
      .from(gameBets)
      .where(
        and(
          eq(gameBets.roundId, roundId),
          eq(gameBets.userId, userId),
          eq(gameBets.status, GameBetStatus.ACTIVE),
        ),
      )
      .orderBy(desc(gameBets.createdAt))
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
      playerName: GameBetRepository.displayName(user),
    }));
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
    return this.page(options, eq(gameBets.userId, userId));
  }

  /**
   * What to call a player, for anyone in this module that has only an id.
   *
   * Here rather than through `UsersRepository` because `UsersModule` exports
   * nothing, deliberately - and this module already reads the `users` table for
   * the lobby list, through the join above. Same table, same `displayName` rule,
   * no new coupling between features.
   */
  playerNameFor(userId: string): string | undefined {
    const row = this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    return row === undefined ? undefined : GameBetRepository.displayName(row);
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
