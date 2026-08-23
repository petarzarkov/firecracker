import { describe, expect, test } from 'bun:test';
import { tensionAt } from './layers/rocket.js';

/**
 * The strain before a launch, which is the only thing that happens on this chart
 * during the betting window - so it has to be right at both ends. Left running
 * past zero it rumbles through a round it is no longer part of; started too early
 * it is a shudder the whole way through the wait and stops meaning "now".
 */
describe('the pre-launch tension', () => {
  test('is nothing outside a betting window', () => {
    expect(tensionAt(null)).toBe(0);
    expect(tensionAt(undefined)).toBe(0);
  });

  test('is nothing at the top of a long window', () => {
    expect(tensionAt(20_000)).toBe(0);
  });

  test('builds as the countdown runs out', () => {
    let previous = -1;
    for (const left of [5000, 4000, 3000, 2000, 1000, 500, 0]) {
      const tension = tensionAt(left);
      expect(tension).toBeGreaterThanOrEqual(previous);
      previous = tension;
    }
    expect(previous).toBe(1);
  });

  /**
   * The countdown is read against the client's clock, so it goes negative between
   * the window closing and the server's `running` frame arriving. Unclamped that is
   * a tension climbing without bound, and the rumble it drives with it.
   */
  test('stays at full strain once the window has closed', () => {
    expect(tensionAt(0)).toBe(1);
    expect(tensionAt(-250)).toBe(1);
    expect(tensionAt(-30_000)).toBe(1);
  });

  test('never leaves 0..1', () => {
    for (const left of [-1e6, -1, 0, 1, 3999, 4000, 4001, 1e6]) {
      const tension = tensionAt(left);
      expect(tension).toBeGreaterThanOrEqual(0);
      expect(tension).toBeLessThanOrEqual(1);
    }
  });
});
