import { Database } from 'bun:sqlite';

/**
 * Opens the same SQLite file the app under test opened. WAL is on, so a second
 * reader is fine while the server holds the writer.
 */
export class DbClient {
  readonly #db: Database;

  constructor(path: string) {
    this.#db = new Database(path, { strict: true });
  }

  /**
   * The id of a user the **application** created. Nothing here inserts one any
   * more: a row written straight into `user` has no `account` row and therefore no
   * password hash, so it could never sign in. The first administrator comes from
   * `AuthAdminSeeder`, through better-auth's own sign-up.
   */
  idFor(email: string): string {
    const row = this.#db
      .query('SELECT id FROM user WHERE email = ?')
      .get(email) as { id: string } | null;
    if (row === null) throw new Error(`no user row for ${email}`);
    return row.id;
  }

  countRows(
    table:
      | 'session'
      | 'account'
      | 'file'
      | 'game_round'
      | 'game_bet'
      | 'wallet',
  ): number {
    const row = this.#db
      .query(`SELECT count(*) AS n FROM "${table}"`)
      .get() as { n: number } | null;
    return row?.n ?? 0;
  }

  /**
   * An invitation's code, which is the one thing the API deliberately never
   * returns - see the note on the `Invite` schema. This is the database standing
   * in for the email the invitee would have received.
   */
  inviteCodeFor(email: string): string {
    const row = this.#db
      .query('SELECT code FROM invite WHERE email = ?')
      .get(email) as { code: string } | null;
    if (row === null) throw new Error(`no invite for ${email}`);
    return row.code;
  }

  countAuditRows(entityId: string): number {
    const row = this.#db
      .query('SELECT count(*) AS n FROM audit_log WHERE entity_id = ?')
      .get(entityId) as { n: number } | null;
    return row?.n ?? 0;
  }

  /** The newest round, whatever phase it is in. */
  currentRound(): { id: string; status: string } | null {
    return this.#db
      .query(
        'SELECT id, status FROM game_round ORDER BY created_at DESC LIMIT 1',
      )
      .get() as { id: string; status: string } | null;
  }

  close(): void {
    this.#db.close();
  }
}
