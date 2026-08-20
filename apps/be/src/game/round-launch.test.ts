import { beforeEach, describe, expect, test } from 'bun:test';
import { SyncSqliteOptions, type SyncSqliteConnection } from '@dunx/infra/db';
import { LogLevel } from '@dunx/core';
import { RecordingLogger } from '@dunx/testing';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import type { RedisConnection } from '@dunx/infra/redis';
import type { AppConfigService } from '../config/app.config.service.js';
import { MIGRATIONS_FOLDER } from '../infra/db/database.module.js';
import * as schema from '../infra/db/schema.js';
import type { AppSchema } from '../infra/db/tx.js';
import { ClientSeedService } from './fairness/client-seed.service.js';
import { Fairness } from './fairness/fairness.js';
import { GameRoundRepository } from './repos/game-round.repository.js';
import { GameRoundStatus } from './schema/game-round.schema.js';
import { GameRoundService } from './services/game-round.service.js';
import type { GameBetService } from './services/game-bet.service.js';

/**
 * The fairness guarantee at the one moment it can be broken silently.
 *
 * The crash point is drawn at launch from `serverSeed:clientSeed:nonce`. The client
 * seeds live in Redis, and a failed read used to fall back to `{}` - which
 * `Fairness.combine` turns into the constant `'firecracker'`. The round then drew
 * from the server seed alone, a value committed at creation and computable by the
 * house in advance, and recorded itself as provably fair. The record was identical
 * to an idle lobby's, so nothing afterwards could tell the two apart.
 *
 * `fairness/fairness.test.ts` covers the values. This file covers the **order** they
 * are produced in, which is the half that only exists once there is a round row to
 * watch: committed and undrawn at creation, drawn from the pool at the launch, and
 * never the other way round.
 */
let connection: SyncSqliteConnection<AppSchema>;
let rounds: GameRoundRepository;
let logger: RecordingLogger;

const config = {
  get: () => ({ waitingMs: 5_000 }),
} as unknown as AppConfigService;

let nonce = 0;

/**
 * Only the two commands the seed pool reaches for here. `incr` is the round nonce,
 * and it has to count for real - the crash-point draw is seeded with it.
 */
const serviceOver = (redis: Pick<RedisConnection, 'hgetall'>) =>
  new GameRoundService(
    rounds,
    // No bets are placed here, so settling them is a no-op. `bet-actions.test.ts`
    // is where settlement itself is asserted.
    { settleAllBetsAsLost: () => 0 } as unknown as GameBetService,
    connection.db,
    new ClientSeedService(
      {
        incr: () => Promise.resolve(++nonce),
        ...redis,
      } as unknown as RedisConnection,
      config,
      logger,
    ),
    config,
    logger,
  );

const waitingRound = (): string =>
  rounds.create({ seed: crypto.randomUUID(), seedHash: crypto.randomUUID() })
    .id;

beforeEach(() => {
  connection = new SyncSqliteOptions({
    schema,
    filename: ':memory:',
    pragmas: ['foreign_keys = ON'],
  }).openSync();
  migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
  rounds = new GameRoundRepository(connection.db);
  logger = new RecordingLogger();
  nonce = 0;
});

describe('launching a round when Redis is unreachable', () => {
  test('refuses to launch, and leaves the round WAITING', async () => {
    const service = serviceOver({
      hgetall: () => Promise.reject(new Error('connect ECONNREFUSED')),
    });
    const roundId = waitingRound();

    expect(await service.transitionToRunning(roundId)).toBeUndefined();

    const round = rounds.findById(roundId);
    expect(round?.status).toBe(GameRoundStatus.WAITING);
    // Never committed, so the house has published no crash point it drew alone.
    expect(round?.crashPointX100).toBeNull();
    expect(round?.clientSeed).toBeNull();
  });

  test('says so at error, because the old failure was silent', async () => {
    const service = serviceOver({
      hgetall: () => Promise.reject(new Error('connect ECONNREFUSED')),
    });

    await service.transitionToRunning(waitingRound());

    expect(logger.at(LogLevel.ERROR).map((entry) => entry.message)).toContain(
      'cannot launch a round without its client seeds',
    );
  });
});

describe('launching a round with a healthy Redis', () => {
  /**
   * An empty hash is legitimate - an idle lobby has no players, so no seeds - and
   * must still launch. This is the case the failure used to impersonate.
   */
  test('an empty seed pool still launches', async () => {
    const service = serviceOver({ hgetall: () => Promise.resolve({}) });
    const roundId = waitingRound();

    const started = await service.transitionToRunning(roundId);

    expect(started?.status).toBe(GameRoundStatus.RUNNING);
    expect(started?.crashPointX100).toBeGreaterThanOrEqual(100);
  });

  test('submitted seeds reach the draw', async () => {
    const service = serviceOver({
      hgetall: () => Promise.resolve({ 'user-a': 'aaa', 'user-b': 'bbb' }),
    });

    const started = await service.transitionToRunning(waitingRound());

    expect(started?.clientSeed).toBe(Fairness.combine(['aaa', 'bbb']));
    expect(started?.clientSeed).not.toBe(Fairness.combine([]));
  });
});

/**
 * The four stages, asserted as a sequence rather than as four values.
 *
 * Nothing checked this before, and it is the property `CLAUDE.md` says is not
 * negotiable: the commitment exists before anyone bets, the crash point does not
 * exist until the window shuts, and when it appears it is the draw over the seeds
 * that were actually collected. A reordering that drew at creation, or that folded
 * the pool from the wrong input, still produces a plausible round row - so only
 * recomputing the number by hand catches it.
 */
describe('the order a round is built in', () => {
  test('committed and undrawn at creation, drawn from the pool at the launch', async () => {
    const service = serviceOver({
      hgetall: () => Promise.resolve({ 'user-a': 'aaa', 'user-b': 'bbb' }),
    });

    const created = await service.createNextRound();

    expect(created.seedHash).toBe(Fairness.commit(created.seed));
    // The crash point cannot exist yet: the players have not contributed.
    expect(created.crashPointX100).toBeNull();
    expect(created.clientSeed).toBeNull();

    const started = await service.transitionToRunning(created.id);

    expect(started?.crashPointX100).toBe(
      Fairness.crashPointX100(
        created.seed,
        Fairness.combine(['aaa', 'bbb']),
        created.nonce,
        Fairness.DEFAULT_ALGORITHM,
      ),
    );
    // The seed committed at creation is the one the draw used, unchanged.
    expect(started?.seed).toBe(created.seed);
    expect(started?.seedHash).toBe(created.seedHash);
  });

  /**
   * The pool is read at the launch and nowhere else. Reading it a second time -
   * after the draw, say - would let a seed submitted late change the recorded
   * `clientSeed` away from the one the crash point was drawn from.
   */
  test('the pool is collected exactly once per launch', async () => {
    let reads = 0;
    const service = serviceOver({
      hgetall: () => {
        reads += 1;
        return Promise.resolve({ 'user-a': 'aaa' });
      },
    });

    await service.transitionToRunning(waitingRound());

    expect(reads).toBe(1);
  });
});

/**
 * Three places enqueue the schedule job and only one of them can scope a `jobId` to
 * a round, so the loop stays single by guarding on state. Two boots used to mean two
 * rounds. The guard lives in `GameJobs.schedule`, not in `createNextRound` - a method
 * named create should create, and `game.spec.ts` legitimately wants a fresh round per
 * test - so what is asserted here is the read the handler guards on.
 */
describe('scheduling the next round', () => {
  test('currentRound sees a live round, so the handler can refuse', async () => {
    const service = serviceOver({ hgetall: () => Promise.resolve({}) });

    expect(service.currentRound()).toBeUndefined();

    const first = await service.createNextRound();
    expect(service.currentRound()?.id).toBe(first.id);

    await service.transitionToRunning(first.id);
    expect(service.currentRound()?.id).toBe(first.id);
  });

  test('a crashed round is no longer current', async () => {
    const service = serviceOver({ hgetall: () => Promise.resolve({}) });
    const first = await service.createNextRound();
    await service.transitionToRunning(first.id);
    service.settleCrash(first.id);

    expect(service.currentRound()).toBeUndefined();

    const second = await service.createNextRound();
    expect(second.id).not.toBe(first.id);
    expect(second.nonce).toBe(first.nonce + 1);
  });
});
