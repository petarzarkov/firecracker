import { beforeEach, describe, expect, test } from 'bun:test';
import type { EventsPublisher } from '../../notifications/events/events.publisher.js';
import type { WalletService } from '../../wallet/services/wallet.service.js';
import type { CrashEngineService } from '../engine/crash-engine.service.js';
import type { ClientSeedService } from '../fairness/client-seed.service.js';
import { GAME_EVENTS, GAME_TOPIC } from '../game.events.js';
import type { GameBetRow } from '../betting/game-bet.schema.js';
import { GameRoundStatus } from '../rounds/game-round.schema.js';
import type { AutoCashOutService } from '../betting/auto-cashout.service.js';
import {
  BetRejected,
  type GameBetService,
} from '../betting/game-bet.service.js';
import { BetActionsService } from './bet-actions.service.js';
import type { SocketPlayer } from './socket-auth.service.js';

/**
 * The socket's money path, with stubs and no container. Where `betting/`'s
 * `bet-actions.test.ts` covers what a debit does to the database, this covers the
 * layer above: the phase gate, the ack a refusal becomes, which wallet a bare
 * `cashOut` settles against, and the frames each action publishes. Every case below
 * is a bug that shipped once.
 */
const ROUND_ID = 'round-1';

const player: SocketPlayer = {
  userId: 'user-1',
  email: 'ada@example.com',
  username: 'ada',
  picture: null,
  roles: [],
};

interface Frame {
  readonly topic: string;
  readonly event: string;
  readonly data: Record<string, unknown>;
}

let published: Frame[];
let seeded: string[];
let stored: unknown[];
let cashOutCalls: number[];
let multiplierReads: number;

/** The engine, as far as this service can see it: three reads and no clock. */
let engine: {
  phase: GameRoundStatus | null;
  roundId: string | null;
  currentMultiplierX100: () => number | null;
  graceMultiplierX100: () => number | null;
};

let bets: {
  placeBet: (...args: unknown[]) => GameBetRow;
  cashOut: (...args: unknown[]) => GameBetRow;
  findActiveByRoundAndUserAnyMode: () => GameBetRow | undefined;
};

const betRow = (over: Partial<GameBetRow> = {}): GameBetRow =>
  ({
    id: 'bet-1',
    roundId: ROUND_ID,
    userId: player.userId,
    betAmountCents: 500,
    payoutCents: null,
    isDemo: true,
    ...over,
  }) as GameBetRow;

const subject = (): BetActionsService =>
  new BetActionsService(
    engine as unknown as CrashEngineService,
    bets as unknown as GameBetService,
    {
      getWallet: (_userId: string, isDemo: boolean) => ({
        balanceCents: isDemo ? 4500 : 100,
      }),
    } as unknown as WalletService,
    {
      store: (...args: unknown[]) => {
        stored.push(args);
        return Promise.resolve();
      },
    } as unknown as AutoCashOutService,
    {
      contributeIfAbsent: (_roundId: string, userId: string) => {
        seeded.push(userId);
        return Promise.resolve();
      },
    } as unknown as ClientSeedService,
    {
      publish: (topic: string, event: string, data: unknown) => {
        published.push({ topic, event, data: data as Record<string, unknown> });
      },
    } as unknown as EventsPublisher,
  );

const frame = (event: string): Frame | undefined =>
  published.find((f) => f.event === event);

beforeEach(() => {
  published = [];
  seeded = [];
  stored = [];
  cashOutCalls = [];
  multiplierReads = 0;

  engine = {
    phase: GameRoundStatus.WAITING,
    roundId: ROUND_ID,
    currentMultiplierX100: () => null,
    graceMultiplierX100: () => null,
  };

  bets = {
    placeBet: () => betRow(),
    cashOut: (...args: unknown[]) => {
      cashOutCalls.push(args[2] as number);
      return betRow({ payoutCents: 1000 });
    },
    findActiveByRoundAndUserAnyMode: () => betRow(),
  };
});

describe('placing a bet', () => {
  test('a spectator is refused with an ack, not a throw', async () => {
    const ack = await subject().place(null, { betAmountCents: 500 });

    expect(ack).toEqual({
      success: false,
      error: 'Login required to place bets',
    });
    expect(published).toHaveLength(0);
  });

  test('bets are refused outside the waiting phase', async () => {
    engine.phase = GameRoundStatus.RUNNING;

    const ack = await subject().place(player, { betAmountCents: 500 });

    expect(ack.success).toBe(false);
    expect(ack.error).toContain('waiting phase');
  });

  test('bets are refused when there is no round', async () => {
    engine.roundId = null;

    const ack = await subject().place(player, { betAmountCents: 500 });

    expect(ack).toEqual({ success: false, error: 'No active round' });
  });

  test('an unparseable body is refused before the wallet is touched', async () => {
    const ack = await subject().place(player, { betAmountCents: 1.5 });

    expect(ack).toEqual({ success: false, error: 'Invalid bet' });
    expect(seeded).toHaveLength(0);
  });

  /**
   * A `BetRejected` is written for the player and goes through verbatim; anything
   * else is ours. An internal error string in a `betAck` is an information leak on
   * a gambling surface.
   */
  test('a BetRejected reaches the player and any other error does not', async () => {
    bets.placeBet = () => {
      throw new BetRejected('Insufficient demo balance');
    };
    expect((await subject().place(player, { betAmountCents: 500 })).error).toBe(
      'Insufficient demo balance',
    );

    bets.placeBet = () => {
      throw new Error('SQLITE_BUSY: database is locked');
    };
    expect((await subject().place(player, { betAmountCents: 500 })).error).toBe(
      'Failed to place bet',
    );
  });

  /**
   * The pool contribution happens only for a bet that was actually taken. A seed
   * from a refused bet would be entropy the round claims from a player who is not
   * in it.
   */
  test('a refused bet contributes no entropy', async () => {
    bets.placeBet = () => {
      throw new BetRejected('nope');
    };

    await subject().place(player, { betAmountCents: 500 });

    expect(seeded).toHaveLength(0);
  });

  test('an accepted bet contributes entropy and publishes both frames', async () => {
    const ack = await subject().place(player, {
      betAmountCents: 500,
      isDemo: true,
    });

    expect(ack).toEqual({
      success: true,
      userId: player.userId,
      username: 'ada',
      betAmountCents: 500,
    });
    expect(seeded).toEqual([player.userId]);

    // Addressed to the player alone; the lobby frame goes to everyone.
    expect(frame(GAME_EVENTS.WALLET_UPDATED)?.topic).toBe('user_user-1');
    expect(frame(GAME_EVENTS.BET_PLACED)?.topic).toBe(GAME_TOPIC);
    // Without `userId` the client cannot tell the frame is about itself, which is
    // the bug that shipped three times.
    expect(frame(GAME_EVENTS.BET_PLACED)?.data['userId']).toBe(player.userId);
  });

  test('an auto-cashout target is registered, and only when asked for', async () => {
    await subject().place(player, { betAmountCents: 500, isDemo: true });
    expect(stored).toHaveLength(0);

    await subject().place(player, {
      betAmountCents: 500,
      isDemo: true,
      autoCashOutAt: 2.5,
    });
    expect(stored).toEqual([[ROUND_ID, player.userId, 'ada', 2.5, true]]);
  });
});

describe('cashing out', () => {
  beforeEach(() => {
    engine.phase = GameRoundStatus.RUNNING;
    engine.currentMultiplierX100 = () => {
      multiplierReads += 1;
      // Climbs on every read, so a second read cannot go unnoticed.
      return 200 + multiplierReads;
    };
  });

  test('a spectator is refused with an ack, not a throw', () => {
    expect(subject().cashOut(null, {})).toEqual({
      success: false,
      error: 'Login required to cash out',
    });
  });

  /**
   * The multiplier is read **once**, at entry, and that value is what is paid. A
   * second read would pay whatever the curve had climbed to while the row was
   * written rather than what the player saw when they clicked.
   */
  test('the multiplier is read once and paid at that value', () => {
    const ack = subject().cashOut(player, {});

    expect(multiplierReads).toBe(1);
    expect(cashOutCalls).toEqual([201]);
    expect(ack.multiplier).toBe(2.01);
  });

  /**
   * The regression `game.spec.ts` documents, at the layer that makes the decision.
   * `BetPanel` sends a bare `cashOut` with no payload, so defaulting to real money
   * rejected every demo cash-out - silently, because a rejection is an ack.
   */
  test('the open bet decides the wallet when the client says nothing', () => {
    bets.findActiveByRoundAndUserAnyMode = () => betRow({ isDemo: true });

    const ack = subject().cashOut(player, {});

    expect(ack.success).toBe(true);
    expect(frame(GAME_EVENTS.BET_CASHED_OUT)?.data['isDemo']).toBe(true);
    expect(frame(GAME_EVENTS.WALLET_UPDATED)?.data['balanceCents']).toBe(4500);
  });

  test('an explicit isDemo from the client still wins', () => {
    bets.findActiveByRoundAndUserAnyMode = () => betRow({ isDemo: true });

    subject().cashOut(player, { isDemo: false });

    expect(frame(GAME_EVENTS.BET_CASHED_OUT)?.data['isDemo']).toBe(false);
  });

  test('with no open bet nothing is settled', () => {
    bets.findActiveByRoundAndUserAnyMode = () => undefined;

    expect(subject().cashOut(player, {})).toEqual({
      success: false,
      error: 'No active bet found for this round',
    });
    expect(cashOutCalls).toHaveLength(0);
  });

  /**
   * A click that left the browser before the crash should not be punished for its
   * round-trip time, so a cash-out arriving just after settles at the crash point.
   */
  test('a cash-out inside the grace window settles at the crash point', () => {
    engine.phase = GameRoundStatus.CRASHED;
    engine.currentMultiplierX100 = () => null;
    engine.graceMultiplierX100 = () => 742;

    const ack = subject().cashOut(player, {});

    expect(cashOutCalls).toEqual([742]);
    expect(ack.multiplier).toBe(7.42);
  });

  test('past the grace window it is refused', () => {
    engine.currentMultiplierX100 = () => null;
    engine.graceMultiplierX100 = () => null;

    expect(subject().cashOut(player, {})).toEqual({
      success: false,
      error: 'Round is not currently running',
    });
  });

  /** Both frames carry `userId`, for the same reason `betPlaced` does. */
  test('both frames carry the player id', () => {
    subject().cashOut(player, {});

    expect(frame(GAME_EVENTS.BET_CASHED_OUT)?.data['userId']).toBe(
      player.userId,
    );
    expect(frame(GAME_EVENTS.WALLET_UPDATED)?.topic).toBe('user_user-1');
  });

  test('a BetRejected reaches the player and any other error does not', () => {
    bets.cashOut = () => {
      throw new BetRejected('No active bet found for this round');
    };
    expect(subject().cashOut(player, {}).error).toBe(
      'No active bet found for this round',
    );

    bets.cashOut = () => {
      throw new Error('SQLITE_BUSY: database is locked');
    };
    expect(subject().cashOut(player, {}).error).toBe('Failed to cash out');
  });
});
