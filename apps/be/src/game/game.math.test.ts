import { describe, expect, test } from 'bun:test';
import { Rng } from '@arkv/rng';
import { GameMath } from './game.math.js';

describe('multipliers are integer hundredths', () => {
  test('the two conversions round-trip', () => {
    expect(GameMath.toMultiplier(107)).toBe(1.07);
    expect(GameMath.fromMultiplier(1.07)).toBe(107);
    expect(GameMath.fromMultiplier(GameMath.toMultiplier(12_345))).toBe(12_345);
  });

  test('the curve starts at 1.00x and only climbs', () => {
    expect(GameMath.multiplierAtX100(0, 10_000)).toBe(100);
    let previous = 0;
    for (let elapsed = 0; elapsed <= 20_000; elapsed += 250) {
      const now = GameMath.multiplierAtX100(elapsed, 10_000);
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
  });

  test('it truncates rather than rounds, so a shown multiplier was reached', () => {
    // e^(3000/10000) = 1.34985…, which must read 1.34 and never 1.35: a player is
    // paid the number on their screen, and 1.35 was never true.
    expect(GameMath.multiplierAtX100(3000, 10_000)).toBe(134);
  });
});

describe('payouts', () => {
  test('a 100-cent bet at 2.00x pays 200', () => {
    expect(GameMath.payoutCents(100, 200)).toBe(200);
  });

  test('integer arithmetic beats the float multiply it replaced', () => {
    // The old code was `Math.floor(bet * multiplier)` against a float. At the
    // hundredths that matter, that lost a cent; this cannot.
    expect(GameMath.payoutCents(100, 207)).toBe(207);
    expect(GameMath.payoutCents(333, 300)).toBe(999);
    expect(GameMath.payoutCents(1, 199)).toBe(1);
  });

  test('a payout is never more than the arithmetic allows', () => {
    for (const stake of [1, 7, 100, 12_345]) {
      for (const x100 of [100, 101, 250, 999, 10_000]) {
        const paid = GameMath.payoutCents(stake, x100);
        expect(paid).toBeLessThanOrEqual((stake * x100) / 100);
        expect(Number.isInteger(paid)).toBe(true);
      }
    }
  });
});

describe('the crash point is provably fair', () => {
  const seed = 'a'.repeat(64);

  test('the same inputs always give the same answer', () => {
    const once = GameMath.crashPointX100(seed, 'client', 1);
    const twice = GameMath.crashPointX100(seed, 'client', 1);
    expect(once).toBe(twice);
  });

  test('the nonce changes the outcome, so a seed pair cannot repeat', () => {
    const first = GameMath.crashPointX100(seed, 'client', 1);
    const second = GameMath.crashPointX100(seed, 'client', 2);
    expect(first).not.toBe(second);
  });

  test('the client seed changes the outcome, which is the players’ influence', () => {
    expect(GameMath.crashPointX100(seed, 'alice', 1)).not.toBe(
      GameMath.crashPointX100(seed, 'bob', 1),
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

    const rngSeed = GameMath.fairnessSeed(seed, clientSeed, nonce);
    expect(rngSeed).toBe(`${seed}:${clientSeed}:${nonce}`);

    const rng = new Rng(rngSeed, GameMath.DEFAULT_RNG_ALGORITHM);
    const u = rng.float();
    rng.free();
    const byHand = u < 0.03 ? 100 : Math.max(100, Math.floor(99 / (1 - u)));

    expect(GameMath.crashPointX100(seed, clientSeed, nonce)).toBe(byHand);
  });

  test('it never returns less than 1.00x', () => {
    for (let nonce = 0; nonce < 2000; nonce += 1) {
      expect(GameMath.crashPointX100(seed, 'c', nonce)).toBeGreaterThanOrEqual(
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
      const x100 = GameMath.crashPointX100(`server-${i}`, `client-${i}`, i);
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
