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
} from './game-bet.schema.js';
import { gameRounds, GameRoundStatus } from '../rounds/game-round.schema.js';

/** A bet with the display name the lobby shows next to it. */
export interface BetWithPlayer extends GameBetRow {
  readonly playerName: string;
}

/**
 * A bet with the multiplier its round exploded at. `null` for any round that is not
 * CRASHED, which is not the same as "not drawn yet" - `crash_point_x100` is written
 * at the transition to RUNNING, so an unfiltered read hands a player the outcome of
 * the round they are still betting in.
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
   * The player's open bet, whichever wallet it is against - a cash-out should not
   * need the client to say, since the row already knows and survives a reconnect.
   * A player can hold one bet per mode, so this returns the newest and a caller may
   * still pass an explicit mode.
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
   * The lobby list. One join rather than a per-row lookup, because this runs on
   * every socket connect.
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
      // A static rather than a query, so this join stays one statement. Two copies
      // of the rule would give one player two names.
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
   * The player's own history. Two statements rather than a join because that is
   * `paginate`'s shape - the keyset cursor is a `created_at`/`id` pair from
   * `game_bet` alone, with no hook to widen the select - so the rounds behind a page
   * are one `IN` bounded by `take`.
   */
  listByUser(userId: string, options: PageOptions): Page<BetWithCrash> {
    const page = this.page(options, eq(gameBets.userId, userId));
    return { ...page, data: this.#withCrashPoints(page.data) };
  }

  /**
   * The status filter is the fairness rule, in SQL: a RUNNING round already holds
   * its `crash_point_x100`, so an unconditional select tells a player where the
   * rocket stops while their bet is open.
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
