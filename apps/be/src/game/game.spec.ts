import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../app.module.js';
import { EnvConfig } from '../config/env.validation.js';
import { AppHttpOptions } from '../http.options.js';
import { TestSession } from '../test-support/session.js';
import { GameRoundStatus } from './schema/game-round.schema.js';
import { GameBetStatus } from './schema/game-bet.schema.js';
import { BetRejected, GameBetService } from './services/game-bet.service.js';
import { GameRoundService } from './services/game-round.service.js';
import { WalletService } from '../wallet/services/wallet.service.js';
import { GameRoundRepository } from './repos/game-round.repository.js';
import { GameRoundWatchdog } from './services/game-watchdog.service.js';
import {
  dropTestNamespaces,
  testNamespace,
} from '../test-support/namespace.js';

/**
 * The money path, against a real in-memory SQLite and the real container.
 *
 * The engine is not involved: it is a clock, and a clock in a test is a source of
 * flake. Rounds are driven straight through the repository here, which is exactly
 * what the worker's job handlers do.
 */
let server: TestServer;
let bets: GameBetService;
let rounds: GameRoundService;
let wallets: WalletService;
let roundRepo: GameRoundRepository;
let watchdog: GameRoundWatchdog;
let userId: string;

const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: ':memory:',
  // Off: this graph includes the engine, which enqueues the first round at `onInit`,
  // so a consuming test server would start the clock under the assertions.
  QUEUE_CONSUME: 'false',
  THROTTLE_LIMIT: '10000',
  ...testNamespace(),
  // Deterministic money: 100 cents minimum, $50.00 demo balance.
  GAME_MIN_BET_CENTS: '100',
  GAME_DEMO_INITIAL_BALANCE_CENTS: '5000',
};

/** A round in WAITING, the state a bet is accepted in. */
const openRound = async (): Promise<string> => {
  const round = await rounds.createNextRound();
  return round.id;
};

/** Move it to RUNNING with a known crash point, without waiting for a clock. */
const launch = (roundId: string, crashPointX100: number): void => {
  roundRepo.transition(roundId, GameRoundStatus.WAITING, {
    status: GameRoundStatus.RUNNING,
    clientSeed: 'test',
    crashPointX100,
    startedAt: new Date(),
  });
};

beforeAll(async () => {
  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    ...AppHttpOptions.for(EnvConfig.validate(source)),
    requestLogging: false,
  });

  bets = server.app.get(GameBetService);
  rounds = server.app.get(GameRoundService);
  wallets = server.app.get(WalletService);
  roundRepo = server.app.get(GameRoundRepository);
  watchdog = server.app.get(GameRoundWatchdog);

  const player = await TestSession.signUp(
    server,
    'player@example.com',
    'a-password-123',
  );
  userId = player.userId;
});

afterAll(async () => {
  await server.close();
});

describe('placing a bet', () => {
  test('debits the demo wallet and writes a ledger row', async () => {
    const roundId = await openRound();
    const before = wallets.getWallet(userId, true).balanceCents;

    const bet = bets.placeBet(userId, roundId, 500, true);

    expect(bet.status).toBe(GameBetStatus.ACTIVE);
    expect(bet.betAmountCents).toBe(500);
    expect(wallets.getWallet(userId, true).balanceCents).toBe(before - 500);

    const ledger = wallets.recentTransactions(userId, true, 1);
    expect(ledger[0]?.type).toBe('bet_debit');
    expect(ledger[0]?.amountCents).toBe(500);
    expect(ledger[0]?.balanceAfterCents).toBe(before - 500);
  });

  test('a second bet in the same round is refused, and refunds nothing', async () => {
    const roundId = await openRound();
    bets.placeBet(userId, roundId, 100, true);
    const after = wallets.getWallet(userId, true).balanceCents;

    expect(() => bets.placeBet(userId, roundId, 100, true)).toThrow(
      BetRejected,
    );
    // The rejected bet must not have moved money on its way out.
    expect(wallets.getWallet(userId, true).balanceCents).toBe(after);
  });

  test('a bet below the minimum is refused', async () => {
    const roundId = await openRound();
    expect(() => bets.placeBet(userId, roundId, 99, true)).toThrow(BetRejected);
  });

  /**
   * The overdraft guard, which lives in the `UPDATE`'s `WHERE` rather than in
   * JavaScript. This is the assertion that would fail if someone "simplified" it
   * into a balance check followed by a debit.
   */
  test('a bet larger than the balance is refused and writes nothing', async () => {
    const roundId = await openRound();
    const balance = wallets.getWallet(userId, true).balanceCents;

    expect(() => bets.placeBet(userId, roundId, balance + 1, true)).toThrow(
      BetRejected,
    );
    expect(wallets.getWallet(userId, true).balanceCents).toBe(balance);
    expect(
      bets.findActiveByRoundAndUser(roundId, userId, true),
    ).toBeUndefined();
  });

  test('the demo and real wallets are separate bets in one round', async () => {
    const roundId = await openRound();
    bets.placeBet(userId, roundId, 100, true);
    // The real wallet opens empty, so this is refused for funds rather than for
    // being a duplicate - which is the point: the unique index is per mode.
    expect(() => bets.placeBet(userId, roundId, 100, false)).toThrow(
      BetRejected,
    );
  });
});

describe('cashing out', () => {
  test('credits the payout and closes the bet', async () => {
    const roundId = await openRound();
    bets.placeBet(userId, roundId, 200, true);
    launch(roundId, 500);
    const afterBet = wallets.getWallet(userId, true).balanceCents;

    const settled = bets.cashOut(userId, roundId, 250, true);

    expect(settled.status).toBe(GameBetStatus.CASHED_OUT);
    expect(settled.cashedOutAtX100).toBe(250);
    // 200 cents at 2.50x, in integer space throughout.
    expect(settled.payoutCents).toBe(500);
    expect(wallets.getWallet(userId, true).balanceCents).toBe(afterBet + 500);
  });

  test('cashing out twice is refused', async () => {
    const roundId = await openRound();
    bets.placeBet(userId, roundId, 100, true);
    launch(roundId, 500);
    bets.cashOut(userId, roundId, 200, true);

    expect(() => bets.cashOut(userId, roundId, 200, true)).toThrow(BetRejected);
  });

  /**
   * The regression. `BetPanel` sends a bare `socket.emit('cashOut')` with no
   * payload, so the gateway has to work out which wallet the bet was against.
   * Defaulting to real money made every demo cash-out fail silently - the bet
   * stayed open, the balance never moved, and the ack was a rejection nobody
   * surfaced. Only a browser found it.
   */
  test('the open bet decides the wallet, not the caller', async () => {
    const roundId = await openRound();
    bets.placeBet(userId, roundId, 300, true);
    launch(roundId, 400);

    const open = bets.findActiveByRoundAndUserAnyMode(roundId, userId);
    expect(open?.isDemo).toBe(true);

    // Which is what lets the gateway cash out a demo bet without being told.
    const settled = bets.cashOut(userId, roundId, 200, open!.isDemo);
    expect(settled.payoutCents).toBe(600);
  });

  test('cashing out with no bet is refused', async () => {
    const roundId = await openRound();
    launch(roundId, 500);
    expect(() => bets.cashOut(userId, roundId, 200, true)).toThrow(BetRejected);
  });
});

describe('settlement', () => {
  test('a crash loses every bet still open, in one transaction', async () => {
    const roundId = await openRound();
    bets.placeBet(userId, roundId, 100, true);
    launch(roundId, 300);
    const afterBet = wallets.getWallet(userId, true).balanceCents;

    const crashed = rounds.settleCrash(roundId);

    expect(crashed?.status).toBe(GameRoundStatus.CRASHED);
    expect(
      bets.findActiveByRoundAndUser(roundId, userId, true),
    ).toBeUndefined();
    // A lost bet pays nothing, so the balance is untouched by the settlement.
    expect(wallets.getWallet(userId, true).balanceCents).toBe(afterBet);
  });

  test('crashing the same round twice settles once', async () => {
    const roundId = await openRound();
    launch(roundId, 300);

    expect(rounds.settleCrash(roundId)).toBeDefined();
    // The status guard in the `WHERE` is what makes a retried job a no-op.
    expect(rounds.settleCrash(roundId)).toBeUndefined();
  });

  test('failing a round refunds the stake and says who to tell', async () => {
    const roundId = await openRound();
    bets.placeBet(userId, roundId, 400, true);
    const afterBet = wallets.getWallet(userId, true).balanceCents;

    const { refunds } = rounds.failAndRefund(roundId);

    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.userId).toBe(userId);
    expect(refunds[0]?.refundedCents).toBe(400);
    expect(wallets.getWallet(userId, true).balanceCents).toBe(afterBet + 400);
  });
});

describe('provable fairness over HTTP', () => {
  test('a round that has not crashed cannot be verified', async () => {
    const roundId = await openRound();
    const { status } = await server.json(`api/game/rounds/${roundId}/verify`);
    expect(status).toBe(404);
  });

  test('the seed is withheld until the crash, then published', async () => {
    const roundId = await openRound();
    launch(roundId, 300);

    const running = await server.json<{ seed?: string; crashPoint?: number }>(
      `api/game/rounds/${roundId}`,
    );
    expect(running.body.seed).toBeUndefined();
    expect(running.body.crashPoint).toBeUndefined();

    rounds.settleCrash(roundId);

    const done = await server.json<{ seed?: string; crashPoint?: number }>(
      `api/game/rounds/${roundId}`,
    );
    expect(done.body.seed).toBeDefined();
    expect(done.body.crashPoint).toBe(3);
  });

  test('the round history is public', async () => {
    const { status } = await server.json('api/game/rounds?take=5');
    expect(status).toBe(200);
  });

  test('a wallet is not', async () => {
    const { status } = await server.json('api/wallet');
    expect(status).toBe(401);
  });
});

/**
 * The watchdog, driven directly rather than through its schedule - waiting out
 * `GAME_CLEANUP_INTERVAL_MS` would put a clock in a test.
 *
 * These are assertions the old `game.round.cleanup` job never had: it rescheduled
 * itself, so testing it meant a broker and a delay. There is no "nothing stale finds
 * nothing" case on purpose - this suite shares one database, so the precondition is
 * false by the time it would run.
 */
describe('the stuck-round watchdog', () => {
  test('a round past the threshold is failed and its stake refunded', async () => {
    const roundId = await openRound();
    bets.placeBet(userId, roundId, 250, true);
    const afterBet = wallets.getWallet(userId, true).balanceCents;

    // Backdated rather than waited out: the same state a round that stalled three
    // minutes ago is in.
    roundRepo.transition(roundId, GameRoundStatus.WAITING, {
      status: GameRoundStatus.RUNNING,
      clientSeed: 'test',
      crashPointX100: 500,
      startedAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    const { failed } = await watchdog.sweep();

    expect(failed).toBeGreaterThanOrEqual(1);
    expect(roundRepo.findById(roundId)?.status).toBe(GameRoundStatus.FAILED);
    expect(wallets.getWallet(userId, true).balanceCents).toBe(afterBet + 250);
  });

  /**
   * Two RUNNING rounds at once should be impossible, and the sweep treats the newest
   * as the real one. Without this the orphan holds its players' bets forever, which
   * is the failure mode a process dying mid-transition leaves behind.
   */
  test('the older of two running rounds is treated as an orphan', async () => {
    const orphanId = await openRound();
    // A minute earlier, explicitly: `launch()` stamps `new Date()`, and two rounds in
    // the same millisecond make the newest-wins tiebreak a coin flip. Real rounds are
    // separated by a betting window.
    roundRepo.transition(orphanId, GameRoundStatus.WAITING, {
      status: GameRoundStatus.RUNNING,
      clientSeed: 'test',
      crashPointX100: 400,
      startedAt: new Date(Date.now() - 60_000),
    });

    const liveId = await openRound();
    launch(liveId, 400);

    await watchdog.sweep();

    expect(roundRepo.findById(orphanId)?.status).toBe(GameRoundStatus.FAILED);
    expect(roundRepo.findById(liveId)?.status).toBe(GameRoundStatus.RUNNING);
  });
});

// Registered last, so it runs after the server has closed. Isolating the suites
// stopped them writing into the application's namespace; this stops them leaving
// their own behind, since bullmq's `meta` keys carry no TTL.
afterAll(async () => {
  await dropTestNamespaces();
});
