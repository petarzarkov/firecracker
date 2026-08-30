import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../app.module.js';
import { TestSession } from '../test-support/session.js';
import { GameRoundStatus } from './rounds/game-round.schema.js';
import { GameBetStatus } from './betting/game-bet.schema.js';
import type { GameBet } from './surface/game.dto.js';
import { BetRejected, GameBetService } from './betting/game-bet.service.js';
import { GameRoundService } from './rounds/game-round.service.js';
import { WalletService } from '../wallet/services/wallet.service.js';
import { GameRoundRepository } from './rounds/game-round.repository.js';
import { GameRoundWatchdog } from './rounds/round-watchdog.service.js';
import { RoundJobs } from './rounds/round.jobs.js';
import { AutoCashOutService } from './betting/auto-cashout.service.js';
import { GameBetRepository } from './betting/game-bet.repository.js';
import type { RoundJob } from './game.events.js';
import type { Job } from 'bullmq';
import { CrashEngineService } from './engine/crash-engine.service.js';
import { GameBotsModule } from './bots/bots.module.js';
import { GameSurfaceModule } from './surface/surface.module.js';
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
let roundJobs: RoundJobs;
let autoCashOut: AutoCashOutService;
let betRepo: GameBetRepository;
let userId: string;
let userToken: string;

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
    requestLogging: false,
  });

  bets = server.app.get(GameBetService);
  rounds = server.app.get(GameRoundService);
  wallets = server.app.get(WalletService);
  roundRepo = server.app.get(GameRoundRepository);
  watchdog = server.app.get(GameRoundWatchdog);
  roundJobs = server.app.get(RoundJobs);
  autoCashOut = server.app.get(AutoCashOutService);
  betRepo = server.app.get(GameBetRepository);

  const player = await TestSession.signUp(
    server,
    'player@example.com',
    'a-password-123',
  );
  userId = player.userId;
  userToken = player.token;
});

afterAll(async () => {
  await server.close();
});

/**
 * `game.module.test.ts` proves the *bindings* are shared without constructing
 * anything; this proves resolution produced one instance. A second engine would
 * tick its own multiplier and enqueue its own crash, which a client sees as the
 * number stuttering between two timelines.
 */
describe('the module graph the app boots', () => {
  test('the bots and the socket resolve the same clock', () => {
    expect(server.app.get(CrashEngineService, GameBotsModule)).toBe(
      server.app.get(CrashEngineService, GameSurfaceModule),
    );
  });

  /**
   * The free half: dunx pushes a warning for every ambiguous import and every
   * shadowed binding, which is exactly what a `forRoot()` on a shared sub-module
   * produces. Empty, or somebody configured a module that had nothing to configure.
   */
  test('nothing in the graph is ambiguous or shadowed', () => {
    expect(server.app.warnings).toEqual([]);
  });
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
   * `BetPanel` sends `cashOut` with no payload, so the gateway works out which
   * wallet the bet was against. Defaulting to real money made every demo cash-out
   * fail silently, and only a browser found it.
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

/**
 * A promise made during the round is kept even if no tick was there to keep it.
 *
 * `AutoCashOutService.sweep` only runs on a tick, and the crashing tick deliberately
 * does not sweep - so a target between the last tick and the crash point was never
 * paid. A restart is the same gap made large: a process that was down while the
 * round ran produced no ticks at all, so every promise settled as a loss even though
 * the curve had passed the target. The crash point is drawn at launch and stored, so
 * the round is knowable after the fact and this is a reconciliation, not a guess.
 */
describe('reconciling auto-cashouts at the crash', () => {
  const crashRound = (roundId: string): Promise<{ settled: boolean }> =>
    roundJobs.crash({ data: { roundId } } as Job<RoundJob>);

  test('a target the round reached is paid, not written off', async () => {
    const roundId = await openRound();
    const placed = bets.placeBet(userId, roundId, 200, true);
    await autoCashOut.store(roundId, userId, 'player', 2, true);
    launch(roundId, 383);
    const afterBet = wallets.getWallet(userId, true).balanceCents;

    // No tick ever ran: this is the settlement doing the reconciling.
    await crashRound(roundId);

    const bet = betRepo.findById(placed.id);
    expect(bet?.status).toBe(GameBetStatus.CASHED_OUT);
    // 200 cents at the target of 2.00x, not at the 3.83x the round reached.
    expect(bet?.cashedOutAtX100).toBe(200);
    expect(bet?.payoutCents).toBe(400);
    expect(wallets.getWallet(userId, true).balanceCents).toBe(afterBet + 400);
  });

  test('a target above the crash point still loses', async () => {
    const roundId = await openRound();
    const placed = bets.placeBet(userId, roundId, 200, true);
    await autoCashOut.store(roundId, userId, 'player', 5, true);
    launch(roundId, 383);
    const afterBet = wallets.getWallet(userId, true).balanceCents;

    await crashRound(roundId);

    expect(betRepo.findById(placed.id)?.status).toBe(GameBetStatus.LOST);
    expect(wallets.getWallet(userId, true).balanceCents).toBe(afterBet);
  });

  /**
   * The engine crashes on `multiplier >= crashPoint` and sweeps only below it, so a
   * target *at* the crash point is one the running round would have refused. The
   * reconciliation has to refuse it too, or a restart pays out what being up would
   * not have.
   */
  test('a target exactly at the crash point is refused, as a tick would', async () => {
    const roundId = await openRound();
    const placed = bets.placeBet(userId, roundId, 200, true);
    await autoCashOut.store(roundId, userId, 'player', 3, true);
    launch(roundId, 300);
    const afterBet = wallets.getWallet(userId, true).balanceCents;

    await crashRound(roundId);

    expect(betRepo.findById(placed.id)?.status).toBe(GameBetStatus.LOST);
    expect(wallets.getWallet(userId, true).balanceCents).toBe(afterBet);
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
 * `GAME_CLEANUP_INTERVAL_MS` would put a clock in a test. There is no "nothing
 * stale" case on purpose: this suite shares one database, so the precondition is
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

/**
 * Over HTTP, because the bug it covers was in the mapper rather than the money:
 * `/api/game/my-bets` never sent `crashPoint`, so every lost row said `x0.00x`.
 */
describe('my bet history', () => {
  const myBets = async (): Promise<GameBet[]> => {
    const { body } = await server.json<{ data: GameBet[] }>(
      'api/game/my-bets?take=20',
      { headers: TestSession.bearer(userToken) },
    );
    return body.data;
  };

  test('a settled bet carries the multiplier its round crashed at', async () => {
    const roundId = await openRound();
    bets.placeBet(userId, roundId, 100, true);
    launch(roundId, 742);

    // While it is running the crash point exists in the row already - drawn at the
    // transition - so this assertion is the one that stops it leaking.
    const open = (await myBets()).find((bet) => bet.roundId === roundId);
    expect(open?.status).toBe(GameBetStatus.ACTIVE);
    expect(open?.crashPoint).toBeUndefined();

    rounds.settleCrash(roundId);

    const settled = (await myBets()).find((bet) => bet.roundId === roundId);
    expect(settled?.status).toBe(GameBetStatus.LOST);
    expect(settled?.crashPoint).toBe(7.42);
  });

  test('a page of bets from many rounds gets each round its own crash point', async () => {
    const first = await openRound();
    bets.placeBet(userId, first, 100, true);
    launch(first, 250);
    rounds.settleCrash(first);

    const second = await openRound();
    bets.placeBet(userId, second, 100, true);
    launch(second, 1099);
    rounds.settleCrash(second);

    const page = await myBets();
    expect(page.find((bet) => bet.roundId === first)?.crashPoint).toBe(2.5);
    expect(page.find((bet) => bet.roundId === second)?.crashPoint).toBe(10.99);
  });
});

// Registered last, so it runs after the server has closed. Isolating the suites
// stopped them writing into the application's namespace; this stops them leaving
// their own behind, since bullmq's `meta` keys carry no TTL.
afterAll(async () => {
  await dropTestNamespaces();
});
