import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import {
  SyncSqliteOptions,
  transactionSync,
  type SyncSqliteConnection,
} from '@dunx/infra/db';
import { RecordingLogger } from '@dunx/testing';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { and, eq } from 'drizzle-orm';
import type { AppConfigService } from '../config/app.config.service.js';
import { MIGRATIONS_FOLDER } from '../infra/db/database.module.js';
import * as schema from '../infra/db/schema.js';
import type { AppSchema } from '../infra/db/tx.js';
import { users } from '../users/schema/user.schema.js';
import { GameBetRepository } from './repos/game-bet.repository.js';
import { GameRoundRepository } from './repos/game-round.repository.js';
import { WalletRepository } from './repos/wallet.repository.js';
import { GameBetStatus, gameBets } from './schema/game-bet.schema.js';
import {
  walletTransactions,
  WalletTransactionType,
} from './schema/wallet.schema.js';
import { BetRejected, GameBetService } from './services/game-bet.service.js';
import { WalletService } from './services/wallet.service.js';

/**
 * The money path, against a real migrated SQLite and no container.
 *
 * `game.spec.ts` drives the same two services through the full graph, which is
 * what makes it slow and what makes it stop at "the balance moved". This file
 * counts rows: exactly one debit, exactly one bet, exactly one ledger entry per
 * movement. Those are the assertions that fail if a refactor of the wallet seam
 * ever debits twice, or commits a balance change with no ledger row beside it,
 * or lets a rolled-back transaction leave a debit behind.
 *
 * No container on purpose. `WalletService` and `GameBetService` need a database,
 * a config and a logger and nothing else, so a suite that boots the engine to
 * reach them is paying for a clock it must then avoid.
 */
const MIN_BET_CENTS = 100;
const OPENING_DEMO_CENTS = 5000;

const config = {
  get: (key: string) => {
    if (key !== 'game') throw new Error(`unexpected config read: ${key}`);
    return {
      minBetCents: MIN_BET_CENTS,
      demoInitialBalanceCents: OPENING_DEMO_CENTS,
    };
  },
} as unknown as AppConfigService;

let connection: SyncSqliteConnection<AppSchema>;
let walletRepo: WalletRepository;
let betRepo: GameBetRepository;
let roundRepo: GameRoundRepository;
let wallets: WalletService;
let bets: GameBetService;
let userId: string;

/** A fresh WAITING round. The crash point does not exist yet, and must not. */
const openRound = (): string =>
  roundRepo.create({
    seed: crypto.randomUUID(),
    seedHash: crypto.randomUUID(),
  }).id;

const balanceOf = (isDemo: boolean): number =>
  wallets.getWallet(userId, isDemo).balanceCents;

/** Every ledger row against one of the caller's wallets, oldest first. */
const ledger = (isDemo: boolean) =>
  connection.db
    .select()
    .from(walletTransactions)
    .where(
      eq(walletTransactions.walletId, wallets.getWallet(userId, isDemo).id),
    )
    .all();

const betRowsIn = (roundId: string) =>
  connection.db
    .select()
    .from(gameBets)
    .where(and(eq(gameBets.roundId, roundId), eq(gameBets.userId, userId)))
    .all();

/**
 * Fixture money, put on a wallet with a bare `UPDATE` rather than through
 * `WalletService.credit`. The service's credit is what the cash-out assertions
 * are testing; using it to arrange them too would make a broken credit look like
 * a passing suite.
 */
const fund = (isDemo: boolean, balanceCents: number): void => {
  connection.db
    .update(schema.wallets)
    .set({ balanceCents })
    .where(eq(schema.wallets.id, wallets.getWallet(userId, isDemo).id))
    .run();
};

beforeAll(() => {
  connection = new SyncSqliteOptions({
    schema,
    filename: ':memory:',
    pragmas: ['foreign_keys = ON'],
  }).openSync();
  migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });

  walletRepo = new WalletRepository(connection.db);
  betRepo = new GameBetRepository(connection.db);
  roundRepo = new GameRoundRepository(connection.db);
  wallets = new WalletService(walletRepo, config, new RecordingLogger());
  bets = new GameBetService(
    betRepo,
    wallets,
    connection.db,
    config,
    new RecordingLogger(),
  );

  const user = connection.db
    .insert(users)
    .values({ email: `${crypto.randomUUID()}@example.com`, name: 'Ada' })
    .returning()
    .get();
  userId = user.id;
});

afterAll(() => {
  connection.closeSync();
});

/** Both wallets back to a known state, so a row count is a count of this test. */
beforeEach(() => {
  connection.db.delete(walletTransactions).run();
  connection.db.delete(gameBets).run();
  fund(true, OPENING_DEMO_CENTS);
  fund(false, 0);
});

describe('placing a bet', () => {
  test('debits once, writes one bet row and one ledger row', () => {
    const roundId = openRound();

    const bet = bets.placeBet(userId, roundId, 500, true);

    expect(bet.status).toBe(GameBetStatus.ACTIVE);
    expect(balanceOf(true)).toBe(OPENING_DEMO_CENTS - 500);
    expect(betRowsIn(roundId)).toHaveLength(1);

    const rows = ledger(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe(WalletTransactionType.BET_DEBIT);
    expect(rows[0]?.amountCents).toBe(500);
    expect(rows[0]?.balanceAfterCents).toBe(OPENING_DEMO_CENTS - 500);
  });

  /**
   * The overdraft guard, which is `WHERE balance_cents >= ?` in the `UPDATE` and
   * not a JavaScript comparison. This is the test that fails if somebody ever
   * "simplifies" it into a read, a check and a write.
   */
  test('a bet larger than the balance changes nothing at all', () => {
    const roundId = openRound();

    expect(() =>
      bets.placeBet(userId, roundId, OPENING_DEMO_CENTS + 1, true),
    ).toThrow(BetRejected);

    expect(balanceOf(true)).toBe(OPENING_DEMO_CENTS);
    expect(ledger(true)).toHaveLength(0);
    expect(betRowsIn(roundId)).toHaveLength(0);
  });

  test('a bet below the minimum is refused before any wallet is read', () => {
    const roundId = openRound();

    expect(() =>
      bets.placeBet(userId, roundId, MIN_BET_CENTS - 1, true),
    ).toThrow(BetRejected);
    expect(ledger(true)).toHaveLength(0);
  });

  test('a second bet in the same round does not debit twice', () => {
    const roundId = openRound();
    bets.placeBet(userId, roundId, 700, true);

    expect(() => bets.placeBet(userId, roundId, 700, true)).toThrow(
      BetRejected,
    );

    expect(balanceOf(true)).toBe(OPENING_DEMO_CENTS - 700);
    expect(betRowsIn(roundId)).toHaveLength(1);
    expect(ledger(true)).toHaveLength(1);
  });

  /**
   * The same refusal, but arriving from the unique index rather than from the
   * `findActiveByRoundAndUser` check above it.
   *
   * `game_bet_round_user_demo_index` covers `(round, user, isDemo)` regardless of
   * status, so a *settled* bet in that slot passes the active-bet check and then
   * fails the insert - which is the shape of the cross-process double bet the
   * index exists for. What matters here is that the debit went back with the
   * transaction: the constraint fires after the wallet has already been written.
   *
   * **The throw is asserted untyped, and that is a finding rather than laziness.**
   * `GameBetService` means to translate this into a `BetRejected` reading "you
   * already have an active bet in this round", and today it cannot:
   * `#isDuplicateBet` tests `error.message.includes('game_bet_round_user_demo_index')`,
   * but bun:sqlite words the message as `UNIQUE constraint failed:
   * game_bet.round_id, game_bet.user_id, game_bet.is_demo` - the columns, never
   * the index name. So the constraint reaches the player as a raw 500. The money
   * is safe either way, which is what the three assertions below are for; when the
   * match is corrected, tighten this `toThrow()` to `BetRejected` and this test
   * becomes the one that would have caught it.
   */
  test('the unique index refuses the insert and the debit rolls back with it', () => {
    const roundId = openRound();
    betRepo.create({
      roundId,
      userId,
      betAmountCents: 100,
      isDemo: true,
      status: GameBetStatus.LOST,
    });

    expect(() => bets.placeBet(userId, roundId, 700, true)).toThrow();

    expect(balanceOf(true)).toBe(OPENING_DEMO_CENTS);
    expect(ledger(true)).toHaveLength(0);
    expect(betRowsIn(roundId)).toHaveLength(1);
  });
});

describe('cashing out', () => {
  /**
   * 300 cents at 1.13x. Chosen because the two arithmetics disagree here:
   * `floor(300 * 113 / 100)` is 339 and `floor(300 * (113 / 100))` is 338, since
   * 1.13 is not 1.13 in float64. A float multiplier in the payout would short the
   * player a cent and this assertion is what says so.
   */
  test('credits floor(stake * x100 / 100), in integer space', () => {
    const roundId = openRound();
    bets.placeBet(userId, roundId, 300, true);
    const afterBet = balanceOf(true);

    const settled = bets.cashOut(userId, roundId, 113, true);

    expect(settled.status).toBe(GameBetStatus.CASHED_OUT);
    expect(settled.cashedOutAtX100).toBe(113);
    expect(settled.payoutCents).toBe(339);
    expect(balanceOf(true)).toBe(afterBet + 339);

    const credit = ledger(true).at(-1);
    expect(credit?.type).toBe(WalletTransactionType.WIN_CREDIT);
    expect(credit?.amountCents).toBe(339);
    expect(credit?.gameBetId).toBe(settled.id);
    // The debit and this credit, and nothing else.
    expect(ledger(true)).toHaveLength(2);
  });

  test('cashing out twice credits once', () => {
    const roundId = openRound();
    bets.placeBet(userId, roundId, 200, true);
    bets.cashOut(userId, roundId, 250, true);
    const paid = balanceOf(true);

    expect(() => bets.cashOut(userId, roundId, 250, true)).toThrow(BetRejected);

    expect(balanceOf(true)).toBe(paid);
    expect(ledger(true)).toHaveLength(2);
  });

  test('cashing out without a bet credits nothing', () => {
    const roundId = openRound();

    expect(() => bets.cashOut(userId, roundId, 250, true)).toThrow(BetRejected);
    expect(balanceOf(true)).toBe(OPENING_DEMO_CENTS);
    expect(ledger(true)).toHaveLength(0);
  });
});

describe('refunding a failed round', () => {
  test('the stake comes back exactly, once', () => {
    const roundId = openRound();
    bets.placeBet(userId, roundId, 400, true);

    const refunds = transactionSync(connection.db, (tx) =>
      bets.refundBetsForRound(roundId, tx),
    );

    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.refundedCents).toBe(400);
    expect(balanceOf(true)).toBe(OPENING_DEMO_CENTS);
    expect(betRowsIn(roundId)[0]?.status).toBe(GameBetStatus.REFUNDED);

    const refund = ledger(true).at(-1);
    expect(refund?.type).toBe(WalletTransactionType.REFUND);
    expect(refund?.amountCents).toBe(400);
    expect(ledger(true)).toHaveLength(2);
  });

  test('a second sweep of the same round refunds nothing', () => {
    const roundId = openRound();
    bets.placeBet(userId, roundId, 400, true);
    transactionSync(connection.db, (tx) =>
      bets.refundBetsForRound(roundId, tx),
    );

    const again = transactionSync(connection.db, (tx) =>
      bets.refundBetsForRound(roundId, tx),
    );

    expect(again).toHaveLength(0);
    expect(balanceOf(true)).toBe(OPENING_DEMO_CENTS);
  });
});

describe('the two wallets', () => {
  test('a demo bet leaves the real balance and its ledger untouched', () => {
    const roundId = openRound();

    bets.placeBet(userId, roundId, 500, true);

    expect(balanceOf(false)).toBe(0);
    expect(ledger(false)).toHaveLength(0);
  });

  /**
   * The unique index is per mode, so one round can hold one bet per wallet. The
   * two must settle independently: a demo cash-out that credited real money, or
   * a real debit that came off the demo balance, is the bug this catches.
   */
  test('one round holds a bet per wallet, and each moves its own money', () => {
    fund(false, 1000);
    const roundId = openRound();

    bets.placeBet(userId, roundId, 500, true);
    bets.placeBet(userId, roundId, 200, false);

    expect(balanceOf(true)).toBe(OPENING_DEMO_CENTS - 500);
    expect(balanceOf(false)).toBe(800);

    bets.cashOut(userId, roundId, 200, false);

    expect(balanceOf(false)).toBe(1200);
    expect(balanceOf(true)).toBe(OPENING_DEMO_CENTS - 500);
    expect(ledger(true)).toHaveLength(1);
    expect(ledger(false)).toHaveLength(2);
  });

  test('a real bet cannot be funded from the demo balance', () => {
    const roundId = openRound();

    expect(() => bets.placeBet(userId, roundId, 200, false)).toThrow(
      BetRejected,
    );
    expect(balanceOf(true)).toBe(OPENING_DEMO_CENTS);
  });
});

describe('the demo reset', () => {
  test('tops the balance back up and writes one ledger row', () => {
    const roundId = openRound();
    bets.placeBet(userId, roundId, 500, true);

    const reset = wallets.resetDemoWallet(userId);

    expect(reset.balanceCents).toBe(OPENING_DEMO_CENTS);
    expect(balanceOf(true)).toBe(OPENING_DEMO_CENTS);

    const rows = ledger(true);
    expect(rows).toHaveLength(2);
    expect(rows.at(-1)?.type).toBe(WalletTransactionType.DEPOSIT);
    expect(rows.at(-1)?.amountCents).toBe(500);
    expect(rows.at(-1)?.balanceAfterCents).toBe(OPENING_DEMO_CENTS);
  });

  test('a wallet already at its opening balance writes nothing', () => {
    wallets.resetDemoWallet(userId);

    expect(balanceOf(true)).toBe(OPENING_DEMO_CENTS);
    expect(ledger(true)).toHaveLength(0);
  });
});
