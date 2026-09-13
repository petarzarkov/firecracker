import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { SyncSqliteOptions, type SyncSqliteConnection } from '@dunx/infra/db';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { MIGRATIONS_FOLDER } from '../../infra/db/database.module.js';
import * as schema from '../../infra/db/schema.js';
import type { AppSchema } from '../../infra/db/tx.js';
import { gameBets } from '../betting/game-bet.schema.js';
import { GameRoundRepository } from './game-round.repository.js';
import { gameRounds, GameRoundStatus } from './game-round.schema.js';

/**
 * Retention against a real migrated SQLite, because the two things worth checking
 * are both the database's behaviour rather than the method's: that the cascade on
 * `game_bet.round_id` actually fires, and that a live round is never deleted.
 *
 * `foreign_keys = ON` is the pragma the app sets in `sqlite.ts`. Without it SQLite
 * silently skips the cascade, so a test on weaker pragmas would pass while the
 * deployed app orphaned every bet it pruned.
 */
let connection: SyncSqliteConnection<AppSchema>;
let repo: GameRoundRepository;

/** Distinct, ascending timestamps: the cutoff is a timestamp comparison, so rows
 * sharing one are all kept and a test built on ties would assert the wrong thing. */
const at = (index: number): Date => new Date(1_700_000_000_000 + index * 1_000);

const addRound = (index: number, status: GameRoundStatus): string => {
  const id = crypto.randomUUID();
  connection.db
    .insert(gameRounds)
    .values({
      id,
      seed: `seed-${index}`,
      seedHash: `hash-${index}`,
      status,
      createdAt: at(index),
      updatedAt: at(index),
    })
    .run();
  return id;
};

beforeAll(() => {
  connection = new SyncSqliteOptions({
    schema,
    filename: ':memory:',
    pragmas: ['foreign_keys = ON'],
  }).openSync();
  migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
  repo = new GameRoundRepository(connection.db);
});

afterAll(() => {
  connection.closeSync();
});

beforeEach(() => {
  connection.db.delete(gameBets).run();
  connection.db.delete(gameRounds).run();
});

describe('pruning to the newest rounds', () => {
  test('keeps exactly the newest and deletes the rest', () => {
    for (let i = 0; i < 10; i++) addRound(i, GameRoundStatus.CRASHED);

    expect(repo.pruneToNewest(4)).toBe(6);

    const left = connection.db.select().from(gameRounds).all();
    expect(left).toHaveLength(4);
    // The four newest, which are the four highest indexes.
    expect(left.map((round) => round.seed).sort()).toEqual([
      'seed-6',
      'seed-7',
      'seed-8',
      'seed-9',
    ]);
  });

  test('deletes nothing when there are fewer rounds than the window', () => {
    for (let i = 0; i < 3; i++) addRound(i, GameRoundStatus.CRASHED);

    expect(repo.pruneToNewest(1_000)).toBe(0);
    expect(connection.db.select().from(gameRounds).all()).toHaveLength(3);
  });

  /** The engine's round. Deleting it would take the game's own state with it. */
  test('never deletes a round that has not finished', () => {
    addRound(0, GameRoundStatus.WAITING);
    addRound(1, GameRoundStatus.RUNNING);
    for (let i = 2; i < 8; i++) addRound(i, GameRoundStatus.CRASHED);

    // A window of one leaves every unfinished round outside it.
    repo.pruneToNewest(1);

    const statuses = connection.db
      .select()
      .from(gameRounds)
      .all()
      .map((round) => round.status);
    expect(statuses).toContain(GameRoundStatus.WAITING);
    expect(statuses).toContain(GameRoundStatus.RUNNING);
  });

  /**
   * The reason the pragma is in `beforeAll`. With `foreign_keys` off SQLite keeps
   * the bet rows and this assertion is what notices.
   */
  test('takes the bets of a deleted round with it', () => {
    const doomed = addRound(0, GameRoundStatus.CRASHED);
    const kept = addRound(1, GameRoundStatus.CRASHED);

    const userId = crypto.randomUUID();
    connection.db
      .insert(schema.users)
      .values({ id: userId, email: `${userId}@example.com`, name: 'punter' })
      .run();

    for (const roundId of [doomed, kept]) {
      connection.db
        .insert(gameBets)
        .values({
          id: crypto.randomUUID(),
          roundId,
          userId,
          betAmountCents: 100,
        })
        .run();
    }
    expect(connection.db.select().from(gameBets).all()).toHaveLength(2);

    expect(repo.pruneToNewest(1)).toBe(1);

    const bets = connection.db.select().from(gameBets).all();
    expect(bets).toHaveLength(1);
    expect(bets[0]?.roundId).toBe(kept);
  });
});
