import { describe, expect, test } from 'bun:test';
import { flightAt, type Point } from './layers/boarding.js';

/**
 * A player flying up to the rocket during the betting window.
 *
 * The arc is what makes it a leap rather than a drag, and it is also the thing
 * that can put somebody down beside the hull instead of in it: the puff of dust
 * and the rocket's lurch both happen at the target, so a climb that ends anywhere
 * else is a figure vanishing into empty plot with a bang somewhere off to the side.
 */
const from: Point = { x: 120, y: 640 };
const to: Point = { x: 520, y: 300 };

describe('the climb', () => {
  test('starts on the launch point', () => {
    const at = flightAt(0, from, to, 140);
    expect(at.x).toBeCloseTo(from.x, 9);
    expect(at.y).toBeCloseTo(from.y, 9);
  });

  test('ends exactly on the rocket, whatever the arc', () => {
    for (const arc of [0, 60, 150, 400]) {
      const at = flightAt(1, from, to, arc);
      expect(at.x).toBeCloseTo(to.x, 9);
      expect(at.y).toBeCloseTo(to.y, 9);
    }
  });

  test('bows above the straight line between the two', () => {
    const arc = 140;
    const straight = from.y + (to.y - from.y) * 0.5;
    // Screen coordinates: above is a smaller y.
    expect(flightAt(0.5, from, to, arc).y).toBeLessThan(straight);
  });

  /**
   * The clump.
   *
   * This eased out - fast off the launch, slowing into the hatch - so a boarder was
   * three quarters of the way there at the halfway point and sat beside the rocket
   * for the rest of its flight. Four players boarding together, which is an ordinary
   * lobby, drew as one pile of sprites under three overlapping labels. Nothing in
   * the geometry was wrong; it took a screenshot to see it at all.
   */
  test('spends its time spread along the path, not hovering at the rocket', () => {
    const span = to.x - from.x;
    for (const t of [0.25, 0.5, 0.75]) {
      const covered = (flightAt(t, from, to, 0).x - from.x) / span;
      expect(covered).toBeCloseTo(t, 6);
    }
  });

  test('four leaving in sequence stay separated the whole way up', () => {
    // The stagger the layer uses, as a fraction of the 76-frame flight.
    const apart = 17 / 76;
    const xs = [0, 1, 2, 3].map(
      (i) => flightAt(0.9 - i * apart, from, to, 140).x,
    );
    const gaps = xs.slice(1).map((x, i) => (xs[i] as number) - x);
    // No two of them within a rocket's width of each other at any moment.
    for (const gap of gaps) expect(gap).toBeGreaterThan(60);
  });

  test('only ever moves toward the rocket', () => {
    let previous = from.x;
    for (let t = 0; t <= 1; t += 0.05) {
      const { x } = flightAt(t, from, to, 140);
      expect(x).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = x;
    }
  });

  /**
   * `advance` derives the progress from a frame counter and a delta, and a long
   * frame - a backgrounded tab, a slow first frame - can step it past the end
   * before the arrival is noticed.
   */
  test('a progress past the end still lands on the rocket', () => {
    const at = flightAt(1.6, from, to, 140);
    expect(at.x).toBeCloseTo(to.x, 9);
    expect(at.y).toBeCloseTo(to.y, 9);
  });
});
