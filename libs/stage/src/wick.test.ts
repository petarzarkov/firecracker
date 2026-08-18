import { describe, expect, test } from 'bun:test';
import { heatOf } from './layers/wick.js';

/**
 * The fuse burns harder as the round climbs. It used to be dimmed the moment a
 * round started, so the rocket flew the whole way up with an unlit fuse.
 */
describe('the fuse heat', () => {
  test('a round that has not moved is barely lit', () => {
    expect(heatOf(1)).toBe(0);
  });

  test('it rises with the multiplier', () => {
    let previous = -1;
    for (const m of [1, 1.5, 2, 3, 5, 8, 10]) {
      const heat = heatOf(m);
      expect(heat).toBeGreaterThan(previous);
      previous = heat;
    }
  });

  test('it saturates at 10x rather than growing without bound', () => {
    expect(heatOf(10)).toBeCloseTo(1, 9);
    expect(heatOf(50)).toBe(1);
    expect(heatOf(5000)).toBe(1);
  });

  test('it stays inside 0..1 for anything a round can report', () => {
    for (const m of [0, 0.5, 1, 2, 100, Number.MAX_SAFE_INTEGER]) {
      const heat = heatOf(m);
      expect(heat).toBeGreaterThanOrEqual(0);
      expect(heat).toBeLessThanOrEqual(1);
    }
  });
});
