import type { Page, PageOptions } from '@dunx/infra/pagination';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { PlayerDirectory } from '../../chat/repos/player-directory.repository.js';
import { CrudRepository } from '../../infra/db/base.repository.js';
import { users } from '../../users/schema/user.schema.js';
import {
  gameBets,
  GameBetStatus,
  type GameBetRow,
  type NewGameBetRow,
} from '../schema/game-bet.schema.js';
import { gameRounds, GameRoundStatus } from '../schema/game-round.schema.js';

/** A bet with the display name the lobby shows next to it. */
export interface BetWithPlayer extends GameBetRow {
  readonly playerName: string;
}

/**
 * A bet with the multiplier its round exploded at.
 *
 * `null` while that round is anything but CRASHED, which is not the same as "not
 * drawn yet": `crash_point_x100` is written at the transition to RUNNING, so a read
 * that did not filter on the status would hand a player the outcome of the round
 * they are currently betting in.
 */
export interface BetWithCrash extends GameBetRow {
  readonly crashPointX100: number | null;
}

export class GameBetRepository extends CrudRepository<
  typeof gameBets,
  GameBetRow,
  NewGameBetRow
> {
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
      // The rule lives in `PlayerDirectory`, which is chat's - a static rather than
      // a query, so this join stays one statement. Two copies of it would mean one
      // player with two names, depending on whether you read the bet list or a
      // message header.
      playerName: PlayerDirectory.displayName(user),
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

  /**
   * The player's own history, with the crash point of every round that has one.
   *
   * Two statements rather than the join `findByRoundWithPlayers` uses, and that is
   * `paginate`'s shape rather than a preference: the keyset seek runs over
   * `game_bet` alone - its cursor is a `created_at`/`id` pair from that table - and
   * there is no hook to widen the select. So a page is read, then the rounds behind
   * it, which is one `IN` bounded by `take`.
   *
   * "MY BETS" renders the crash multiplier on every row that is not a win. Without
   * this, every loss rendered `x0.00x` - a crash point the game cannot produce.
   */
  listByUser(userId: string, options: PageOptions): Page<BetWithCrash> {
    const page = this.page(options, eq(gameBets.userId, userId));
    return { ...page, data: this.#withCrashPoints(page.data) };
  }

  /**
   * The crash points for a page of bets - **only** from rounds that have crashed.
   *
   * The status filter is the fairness rule, in SQL: a RUNNING round already holds
   * its `crash_point_x100`, so selecting it unconditionally would tell a player
   * where the rocket stops while their bet is still open.
   */
  #withCrashPoints(bets: readonly GameBetRow[]): BetWithCrash[] {
    if (bets.length === 0) return [];

    const crashed = new Map(
      this.db
        .select({
          id: gameRounds.id,
          crashPointX100: gameRounds.crashPointX100,
        })
        .from(gameRounds)
        .where(
          and(
            inArray(gameRounds.id, [
              ...new Set(bets.map((bet) => bet.roundId)),
            ]),
            eq(gameRounds.status, GameRoundStatus.CRASHED),
          ),
        )
        .all()
        .map((round) => [round.id, round.crashPointX100] as const),
    );

    return bets.map((bet) => ({
      ...bet,
      crashPointX100: crashed.get(bet.roundId) ?? null,
    }));
  }
}
