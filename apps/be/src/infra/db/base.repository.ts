import { SyncDatabase } from '@dunx/infra/db';
import { paginate, type Page, type PageOptions } from '@dunx/infra/pagination';
import { eq, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { Tx, type AppSchema, type Db, type DbHandle } from './tx.js';

/** A table this base can address by primary key. Every table in the schema has one. */
export type Identified = SQLiteTable & { readonly id: SQLiteColumn };

/**
 * drizzle's `.get()`/`.all()` return a type conditional on the table, which
 * TypeScript cannot reduce while the table is a type parameter - it degrades to
 * `{ [x: string]: any }`. An unavoidable cast, in one place so it stays countable.
 */
const one = <TRow>(value: unknown): TRow | undefined =>
  value as TRow | undefined;
const many = <TRow>(value: unknown): TRow[] => value as TRow[];

/**
 * Reads, and the binding to a transaction handle.
 *
 * Synchronous without exception: the bet path's read-check-write is atomic only
 * *because* none of these can yield, so an `async` method here would silently
 * remove the only thing standing in for a lock.
 */
export abstract class BaseRepository<
  TTable extends Identified,
  TRow extends Record<string, unknown> = TTable['$inferSelect'],
> {
  /**
   * A field rather than a constructor argument, so a subclass needs no constructor
   * of its own and inherits the base's dependency record through the prototype
   * chain instead of shadowing it with an empty one. See `over` below.
   */
  protected abstract readonly table: TTable;

  /**
   * Spelled out, **not `Db`**: `@dunx/transform` emits an annotation's head as a
   * value, so the alias would record `{ unresolved: "db: Db" }` and every
   * repository would fail at *boot* rather than at typecheck.
   */
  constructor(protected readonly db: SyncDatabase<AppSchema>) {}

  /**
   * The same repository bound to a transaction handle. `this: new (db: Db) =>
   * TSelf` rather than a `BaseRepository` return type, so `GameBetRepository.over`
   * is a `GameBetRepository` at both compile and run time - and a subclass that
   * declares an extra constructor parameter stops satisfying the constraint, which
   * is correct: it cannot be rebuilt from a handle alone.
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
   * Keyset page. `orderBy` is stated rather than left to `paginate`'s default -
   * the first of `updatedAt`, `createdAt`, `id` the table has - or a table with
   * `updatedAt` would silently sort by last modification.
   */
  protected page(
    options: PageOptions,
    where?: SQL | undefined,
    orderBy = 'createdAt',
  ): Page<TRow> {
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
 * The write half, for tables where an unconditional write by id is honest.
 *
 * `WalletRepository` deliberately does not extend this: a generic
 * `update(id, { balanceCents })` is exactly the JavaScript balance write that
 * `debit`'s `WHERE balance_cents >= ?` exists to make unexpressible.
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
   * The value type admits explicit `undefined` because `exactOptionalPropertyTypes`
   * separates that from an absent key, and a patch DTO produces the former.
   *
   * No `updatedAt` in the set object: drizzle's `buildUpdateSet` includes any
   * column carrying `$onUpdate` whether or not the caller passed it, and
   * `base.repository.test.ts` is what keeps `updated_at` from silently freezing.
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
