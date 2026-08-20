import { SyncDatabase } from '@dunx/infra/db';
import { paginate, type Page, type PageOptions } from '@dunx/infra/pagination';
import { eq, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { Tx, type AppSchema, type Db, type DbHandle } from './tx.js';

/** A table this base can address by primary key. Every table in the schema has one. */
export type Identified = SQLiteTable & { readonly id: SQLiteColumn };

/**
 * drizzle's `.get()` and `.all()` return a type conditional on the table, and
 * TypeScript cannot reduce it while the table is still a type parameter - it
 * degrades to `{ [x: string]: any }`. These two are that reduction, in one place,
 * for the same reason `Tx.asHandle` is one place: a cast that is unavoidable
 * should be nameable and countable.
 */
const one = <TRow>(value: unknown): TRow | undefined =>
  value as TRow | undefined;
const many = <TRow>(value: unknown): TRow[] => value as TRow[];

/**
 * Reads, and the binding to a transaction handle.
 *
 * Synchronous, except the paginated read. That is not tidiness deferred: the bet
 * path's read-check-write is atomic *because* none of these can yield (see
 * `GameBetService`), so a method here becoming `async` would silently remove the
 * guarantee that replaced `pg_try_advisory_xact_lock`.
 */
export abstract class BaseRepository<
  TTable extends Identified,
  TRow extends Record<string, unknown> = TTable['$inferSelect'],
> {
  /**
   * The table this repository is over. A field rather than a constructor
   * argument, so a subclass needs no constructor of its own - which is what lets
   * it inherit the base's dependency record through the prototype chain instead
   * of shadowing it with an empty one. See `over` below.
   */
  protected abstract readonly table: TTable;

  /**
   * `SyncDatabase<AppSchema>`, spelled out. **Not `Db`**: `@dunx/transform` emits
   * an annotation's head as a value and `Db` is a type alias, so the alias here
   * would record `{ unresolved: "db: Db" }` and every repository in the app would
   * fail to build at boot rather than at typecheck. The type argument is erased
   * before the transform sees it, which is why `AppSchema` is fine.
   */
  constructor(protected readonly db: SyncDatabase<AppSchema>) {}

  /**
   * The same repository bound to a transaction handle, so a service can run its
   * reads and writes inside one. See `infra/db/tx.ts` for why the cast is there
   * and why it is in one place.
   *
   * `this: new (db: Db) => TSelf` rather than a return type of `BaseRepository`: a
   * static factory naming its own class returns the base from every subclass,
   * which is the trap this shape avoids. `new this(...)` builds the receiver, so
   * `GameBetRepository.over(tx)` is a `GameBetRepository` at compile time and at
   * run time. A subclass that ever declares an extra constructor parameter stops
   * satisfying the `this` constraint and its `over()` call becomes a type error -
   * which is correct, because such a repository cannot be rebuilt from a handle
   * alone.
   */
  static over<TSelf>(this: new (db: Db) => TSelf, handle: DbHandle): TSelf {
    return new this(Tx.asHandle(handle));
  }

  findById(id: string): TRow | undefined {
    return one<TRow>(
      this.db.select().from(this.table).where(eq(this.table.id, id)).get(),
    );
  }

  /**
   * Keyset page over this repository's own table.
   *
   * `orderBy` is stated rather than left to `paginate`'s default, which is the
   * first of `updatedAt`, `createdAt`, `id` the table has - so a table with
   * `updatedAt` would silently sort by last modification.
   *
   * Async because `paginate` is, and `paginate` is async because it serves
   * `Bun.SQL` as well as `bun:sqlite`. It is the one method here allowed to be.
   */
  protected page(
    options: PageOptions,
    where?: SQL | undefined,
    orderBy = 'createdAt',
  ): Promise<Page<TRow>> {
    return paginate<TTable, TRow>({
      db: this.db,
      table: this.table,
      options,
      orderBy,
      where,
    });
  }
}

/**
 * The write half, for the tables where an unconditional write by id is the honest
 * API.
 *
 * `WalletRepository` deliberately does not extend this: a generic
 * `update(id, { balanceCents })` is the JavaScript balance check CLAUDE.md
 * forbids, and `debit`'s `WHERE balance_cents >= ?` exists to make that
 * unexpressible. Not inheriting the method is what keeps it that way.
 */
export abstract class CrudRepository<
  TTable extends Identified,
  TRow extends Record<string, unknown> = TTable['$inferSelect'],
  TNew extends Record<string, unknown> = TTable['$inferInsert'],
> extends BaseRepository<TTable, TRow> {
  create(values: TNew): TRow {
    return one<TRow>(
      this.db.insert(this.table).values(values).returning().get(),
    ) as TRow;
  }

  /**
   * `exactOptionalPropertyTypes` separates an absent key from an explicit
   * `undefined`, and a patch DTO produces the latter - so the value type has to
   * admit it.
   *
   * No `updatedAt` in the set object, unlike the four copies this replaces. Every
   * `Columns.updatedAt()` carries `$onUpdate`, and drizzle's `buildUpdateSet`
   * includes any column with an `onUpdateFn` whether or not the caller passed it.
   * `base.repository.test.ts` asserts that, because it is the only thing standing
   * between this method and a table whose `updated_at` silently stops moving.
   */
  update(
    id: string,
    values: { [K in keyof TNew]?: TNew[K] | undefined },
  ): TRow | undefined {
    return one<TRow>(
      this.db
        .update(this.table)
        .set(values)
        .where(eq(this.table.id, id))
        .returning()
        .get(),
    );
  }

  deleteById(id: string): boolean {
    return (
      many<TRow>(
        this.db
          .delete(this.table)
          .where(eq(this.table.id, id))
          .returning()
          .all(),
      ).length > 0
    );
  }
}
