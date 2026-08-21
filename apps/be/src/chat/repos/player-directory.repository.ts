import { eq } from 'drizzle-orm';
import { BaseRepository } from '../../infra/db/base.repository.js';
import { users, type UserRow } from '../../users/schema/user.schema.js';

/**
 * What to call a player, for anything that has only an id.
 *
 * Here rather than through `UsersRepository`, because `UsersModule` exports
 * nothing - deliberately, so a feature cannot reach into another feature's writes.
 * This is read-only over one column set and creates no such path.
 */
export class PlayerDirectory extends BaseRepository<typeof users, UserRow> {
  /**
   * The rule, declared once for the whole app.
   *
   * A `static` so `GameBetRepository`'s lobby join can apply it to rows it has already
   * read without a second query - if the two ever disagreed, one player would have two
   * names depending on whether you were looking at the bet list or a message header.
   */
  static displayName(user: Pick<UserRow, 'name' | 'email' | 'id'>): string {
    return user.name || user.email.split('@')[0] || user.id;
  }

  protected readonly table = users;

  nameFor(userId: string): string | undefined {
    const row = this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    return row === undefined ? undefined : PlayerDirectory.displayName(row);
  }
}
