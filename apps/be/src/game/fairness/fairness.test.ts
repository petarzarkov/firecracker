import { describe, expect, test } from 'bun:test';
import { Rng } from '@arkv/rng';
import { Fairness } from './fairness.js';

/**
 * The provable half of a round, on its own and with no container.
 *
 * The draw's assertions came out of `game.math.test.ts` unchanged when the fairness
 * code left `GameMath`; the three above them are new, and cover the inputs that used
 * to be private methods on `GameRoundService` and were therefore only ever exercised
 * through a database.
 */
describe('the commitment', () => {
  test('a server seed is 32 bytes of hex, and never repeats', () => {
    const seed = Fairness.serverSeed();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(Fairness.serverSeed()).not.toBe(seed);
  });

  /**
   * The check a player runs first: the seed revealed at the crash has to hash to
   * the `seedHash` published before the betting window opened. If this ever stops
   * being SHA256 of the seed alone, every commitment already published is unusable.
   */
  test('the commitment is SHA256 of the seed and nothing else', async () => {
    const seed = Fairness.serverSeed();
    const expected = Buffer.from(
      await crypto.subtle.digest('SHA-256', Buffer.from(seed, 'utf8')),
    ).toString('hex');

    expect(Fairness.commit(seed)).toBe(expected);
  });
});

describe('the client-seed pool', () => {
  /**
   * Sorted before hashing, so a player who could influence the order their seed
   * arrived in still could not influence the outcome.
   */
  test('the order seeds arrive in does not change the combination', () => {
    expect(Fairness.combine(['a', 'b', 'c'])).toBe(
      Fairness.combine(['c', 'a', 'b']),
    );
  });

  test('a different pool is a different value', () => {
    expect(Fairness.combine(['a', 'b'])).not.toBe(Fairness.combine(['a']));
  });

  /**
   * An idle lobby has no players and therefore no seeds, and must still launch.
   * The constant is what `ClientSeedService.collect` refuses to fall back to when
   * Redis is merely unreachable - see `rounds/round-launch.test.ts`.
   */
  test('an empty pool is the documented constant', () => {
    expect(Fairness.combine([])).toBe('firecracker');
  });

  test('an auto seed is 16 bytes of hex, and varies', () => {
    const seed = Fairness.autoClientSeed();
    expect(seed).toMatch(/^[0-9a-f]{32}$/);
    expect(Fairness.autoClientSeed()).not.toBe(seed);
  });
});

describe('the crash point is provably fair', () => {
  const seed = 'a'.repeat(64);

  test('the same inputs always give the same answer', () => {
    const once = Fairness.crashPointX100(seed, 'client', 1);
    const twice = Fairness.crashPointX100(seed, 'client', 1);
    expect(once).toBe(twice);
  });

  test('the nonce changes the outcome, so a seed pair cannot repeat', () => {
    const first = Fairness.crashPointX100(seed, 'client', 1);
    const second = Fairness.crashPointX100(seed, 'client', 2);
    expect(first).not.toBe(second);
  });

  test('the client seed changes the outcome, which is the players’ influence', () => {
    expect(Fairness.crashPointX100(seed, 'alice', 1)).not.toBe(
      Fairness.crashPointX100(seed, 'bob', 1),
    );
  });

  /**
   * The verification a player actually runs, reproduced here. If this breaks, the
   * `howToVerify` steps the API publishes are wrong and every round is
   * unverifiable - which is worse than a wrong number, because it is unfalsifiable.
   */
  test('the published recipe reproduces the published number', () => {
    const clientSeed = 'combined-client-seed';
    const nonce = 42;

    const rngSeed = Fairness.seedString(seed, clientSeed, nonce);
    expect(rngSeed).toBe(`${seed}:${clientSeed}:${nonce}`);

    const rng = new Rng(rngSeed, Fairness.DEFAULT_ALGORITHM);
    const u = rng.float();
    rng.free();
    const byHand = u < 0.03 ? 100 : Math.max(100, Math.floor(99 / (1 - u)));

    expect(Fairness.crashPointX100(seed, clientSeed, nonce)).toBe(byHand);
  });

  test('it never returns less than 1.00x', () => {
    for (let nonce = 0; nonce < 2000; nonce += 1) {
      expect(Fairness.crashPointX100(seed, 'c', nonce)).toBeGreaterThanOrEqual(
        100,
      );
    }
  });

  /**
   * The distribution, which is the house edge.
   *
   * These bounds are wide enough not to be flaky and tight enough to catch a real
   * change. They exist because the *previous* implementation silently missed them:
   * HMAC with a `Math.max(1.0, …)` clamp produced ~5% instant crashes against a
   * documented 3%, because the clamp added its own on top of `h % 33 === 0`.
   */
  test('~3% instant crash, ~50% under 2x, ~9.9% at or above 10x', () => {
    const N = 40_000;
    let instant = 0;
    let underTwo = 0;
    let tenPlus = 0;

    for (let i = 0; i < N; i += 1) {
      const x100 = Fairness.crashPointX100(`server-${i}`, `client-${i}`, i);
      if (x100 === 100) instant += 1;
      if (x100 < 200) underTwo += 1;
      if (x100 >= 1000) tenPlus += 1;
    }

    expect(instant / N).toBeGreaterThan(0.025);
    expect(instant / N).toBeLessThan(0.037);
    expect(underTwo / N).toBeGreaterThan(0.47);
    expect(underTwo / N).toBeLessThan(0.54);
    expect(tenPlus / N).toBeGreaterThan(0.085);
    expect(tenPlus / N).toBeLessThan(0.115);
  });
});
