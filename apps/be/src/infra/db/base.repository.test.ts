import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  SyncSqliteOptions,
  transactionSync,
  type SyncSqliteConnection,
} from '@dunx/infra/db';
import {
  PaginationDirection,
  PaginationOrder,
  type PageOptions,
} from '@dunx/infra/pagination';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { UsersRepository } from '../../users/repos/users.repository.js';
import { MIGRATIONS_FOLDER } from './database.module.js';
import * as schema from './schema.js';
import type { AppSchema } from './tx.js';

/**
 * The base's own behaviour, against a real migrated SQLite and no container.
 *
 * `users` is the table under test because it is the only one with no foreign key,
 * so a row needs nothing else to exist first - and it carries
 * `Columns.updatedAt()`, which is the assertion this file exists for.
 */
let connection: SyncSqliteConnection<AppSchema>;
let repo: UsersRepository;

const anEmail = (): string => `${crypto.randomUUID()}@example.com`;

/**
 * `PageOptions` built by hand rather than through `parsePageOptions`, which parses
 * a query string and would put its own coercion rules between this test and the
 * base it is testing.
 */
const aPage = (take: number, search: string, cursor?: string): PageOptions => ({
  take,
  order: PaginationOrder.DESC,
  direction: PaginationDirection.FORWARD,
  search,
  ...(cursor === undefined ? {} : { cursor }),
});

beforeAll(() => {
  connection = new SyncSqliteOptions({
    schema,
    filename: ':memory:',
    pragmas: ['foreign_keys = ON'],
  }).openSync();
  migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
  repo = new UsersRepository(connection.db);
});

afterAll(() => {
  connection.closeSync();
});

describe('BaseRepository / CrudRepository', () => {
  test('create returns the row and findById reads it back', () => {
    const created = repo.create({ email: anEmail(), name: 'Ada' });

    expect(created.id).toBeString();
    expect(created.name).toBe('Ada');
    expect(repo.findById(created.id)).toEqual(created);
  });

  test('findById on an id nothing has is undefined, not a throw', () => {
    expect(repo.findById(crypto.randomUUID())).toBeUndefined();
  });

  /**
   * The reason `update` does not pass `updatedAt` any more. `Columns.updatedAt()`
   * carries `$onUpdate`, and drizzle's `buildUpdateSet` includes any column with
   * an `onUpdateFn` whether the caller named it or not - so the four explicit
   * `updatedAt: new Date()` this base replaced were writing a value drizzle was
   * about to write anyway. If that ever changes upstream, this fails here rather
   * than as a column that quietly stops moving in production.
   */
  test('update advances updatedAt without being passed it', () => {
    const stale = new Date(1_000);
    const created = repo.create({
      email: anEmail(),
      name: 'Grace',
      createdAt: stale,
      updatedAt: stale,
    });
    expect(created.updatedAt.getTime()).toBe(stale.getTime());

    const updated = repo.update(created.id, { name: 'Grace H' });

    expect(updated?.name).toBe('Grace H');
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(stale.getTime());
    // `createdAt` has no `$onUpdate`, so a write must not touch it.
    expect(updated?.createdAt.getTime()).toBe(stale.getTime());
  });

  test('update on a missing row is undefined', () => {
    expect(
      repo.update(crypto.randomUUID(), { name: 'nobody' }),
    ).toBeUndefined();
  });

  test('deleteById reports whether a row went', () => {
    const created = repo.create({ email: anEmail(), name: 'Edsger' });

    expect(repo.deleteById(created.id)).toBe(true);
    expect(repo.findById(created.id)).toBeUndefined();
    expect(repo.deleteById(created.id)).toBe(false);
  });

  test('page walks a cursor to the end and no further', async () => {
    const marker = crypto.randomUUID();
    for (let i = 0; i < 3; i += 1) {
      repo.create({
        email: anEmail(),
        name: `${marker} ${i}`,
        // Distinct, so the keyset sort is by `createdAt` rather than by the
        // id tiebreak - which is what the cursor is meant to seek on.
        createdAt: new Date(10_000 + i),
      });
    }

    const first = await repo.list(aPage(2, marker));
    expect(first.data).toHaveLength(2);
    expect(first.meta.hasNextPage).toBe(true);
    expect(first.meta.nextCursor).toBeString();

    const second = await repo.list(
      aPage(2, marker, first.meta.nextCursor ?? undefined),
    );
    expect(second.data).toHaveLength(1);
    expect(second.meta.hasNextPage).toBe(false);
    expect(second.meta.nextCursor).toBeNull();

    const seen = [...first.data, ...second.data].map((row) => row.name);
    expect(new Set(seen).size).toBe(3);
  });
});

describe('BaseRepository.over', () => {
  test('the handle it returns writes inside the caller transaction', () => {
    const email = anEmail();
    const id = transactionSync(
      connection.db,
      (tx) => UsersRepository.over(tx).create({ email, name: 'Committed' }).id,
    );

    expect(repo.findById(id)?.name).toBe('Committed');
  });

  test('a throw unwinds what it wrote', () => {
    const email = anEmail();
    expect(() =>
      transactionSync(connection.db, (tx) => {
        UsersRepository.over(tx).create({ email, name: 'Rolled back' });
        throw new Error('nope');
      }),
    ).toThrow('nope');

    expect(repo.findByEmail(email)).toBeUndefined();
  });

  /**
   * The polymorphic `this` on the static, at run time as well as at compile time:
   * `new this(...)` builds the receiver, so a subclass does not get the base back.
   */
  test('it returns the subclass, not the base', () => {
    const bound = transactionSync(connection.db, (tx) =>
      UsersRepository.over(tx),
    );

    expect(bound).toBeInstanceOf(UsersRepository);
    expect(bound.findByEmail).toBeFunction();
  });
});
