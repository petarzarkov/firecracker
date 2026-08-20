import { describe, expect, test } from 'bun:test';
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
