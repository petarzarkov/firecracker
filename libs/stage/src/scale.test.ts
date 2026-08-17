import { describe, expect, test } from 'bun:test';
import { ceilingFor, createScale, gridFor, type Insets } from './scale.js';

const INSETS: Insets = { left: 40, right: 15, top: 20, bottom: 28 };

const scaleAt = (width: number, height: number) => {
  const scale = createScale(INSETS);
  scale.resize(width, height);
  return scale;
};

/** Run `follow` until the easing has settled, the way a round would. */
const settle = (scale: ReturnType<typeof scaleAt>, multiplier: number) => {
  for (let frame = 0; frame < 600; frame++) scale.follow(multiplier);
};

describe('the vertical mapping', () => {
  test('1x sits on the floor of the plot and the ceiling on its roof', () => {
    const scale = scaleAt(800, 400);
    expect(scale.y(1)).toBeCloseTo(scale.plot.bottom, 6);
    expect(scale.y(scale.ceiling)).toBeCloseTo(scale.plot.top, 6);
  });

  test('a bigger multiplier is always higher up the screen', () => {
    const scale = scaleAt(800, 400);
    settle(scale, 40);
    let previous = Number.POSITIVE_INFINITY;
    for (const m of [1, 1.5, 2, 3, 5, 10, 20, 50]) {
      const y = scale.y(m);
      expect(y).toBeLessThan(previous);
      previous = y;
    }
  });

  /**
   * The drift that shipped.
   *
   * The gridlines were mapped through the canvas's real height and the labels
   * through a hardcoded 360px, so the two only agreed at one chart size. Here
   * there is a single mapping, and this pins the property that made the old pair
   * wrong: a multiplier's place in the plot is a *fraction*, so it survives any
   * resize. If a second mapping is ever reintroduced, this is the test it fails.
   */
  test('a multiplier holds its place in the plot at every chart size', () => {
    const fraction = (w: number, h: number, m: number) => {
      const scale = scaleAt(w, h);
      settle(scale, 30);
      const { top, height } = scale.plot;
      return (scale.y(m) - top) / height;
    };

    for (const m of [1, 2, 10, 50]) {
      const small = fraction(600, 200, m);
      const tall = fraction(600, 652, m);
      const huge = fraction(1600, 1400, m);
      expect(tall).toBeCloseTo(small, 9);
      expect(huge).toBeCloseTo(small, 9);
    }
  });

  test('the plot honours its insets', () => {
    const { plot } = scaleAt(800, 400);
    expect(plot.left).toBe(40);
    expect(plot.top).toBe(20);
    expect(plot.right).toBe(785);
    expect(plot.bottom).toBe(372);
    expect(plot.width).toBe(745);
    expect(plot.height).toBe(352);
  });

  test('a zero-sized canvas does not produce a negative plot', () => {
    const { plot } = scaleAt(0, 0);
    expect(plot.width).toBe(0);
    expect(plot.height).toBe(0);
    expect(plot.right).toBeGreaterThanOrEqual(plot.left);
    expect(plot.bottom).toBeGreaterThanOrEqual(plot.top);
  });
});

describe('the ceiling', () => {
  /**
   * The flatline.
   *
   * The old axis normalised against `log(50)` and clamped, so every round past
   * 50x drew as a line pressed to the top of the chart - and the round history
   * routinely carries 99x. The most exciting rounds were the ones the chart
   * refused to show.
   */
  test('a round past 50x is still drawn as a climb', () => {
    const scale = scaleAt(800, 400);
    settle(scale, 99.36);

    expect(scale.ceiling).toBeGreaterThanOrEqual(99.36);
    expect(scale.y(99.36)).toBeGreaterThan(scale.plot.top);
    expect(scale.y(99.36)).toBeLessThan(scale.y(50));
    expect(scale.y(50)).toBeLessThan(scale.y(20));
  });

  test('it leaves headroom, so the curve is never welded to the roof', () => {
    for (const m of [1, 1.9, 4, 12, 60, 300]) {
      expect(ceilingFor(m)).toBeGreaterThan(m);
    }
  });

  test('it climbs during a round and never drops back', () => {
    const scale = scaleAt(800, 400);
    const seen: number[] = [];
    for (const m of [1, 1.4, 2.2, 6, 40, 120, 8, 1.2]) {
      settle(scale, m);
      seen.push(scale.ceiling);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] as number);
    }
  });

  test('it eases rather than snapping, so the curve does not jump', () => {
    const scale = scaleAt(800, 400);
    const opening = scale.ceiling;
    scale.follow(400);
    // One frame must move, and must not arrive.
    expect(scale.ceiling).toBeGreaterThan(opening);
    expect(scale.ceiling).toBeLessThan(400);
  });

  test('reset returns it for the next round', () => {
    const scale = scaleAt(800, 400);
    settle(scale, 250);
    expect(scale.ceiling).toBeGreaterThan(100);
    scale.reset();
    expect(scale.ceiling).toBe(2);
  });

  test('an absurd multiplier is bounded rather than unbounded', () => {
    expect(ceilingFor(10_000)).toBe(5000);
    expect(Number.isFinite(ceilingFor(Number.MAX_SAFE_INTEGER))).toBe(true);
  });
});

describe('the gridlines', () => {
  test('1x is always drawn — it is the line the curve leaves from', () => {
    for (const ceiling of [2, 10, 50, 500, 5000]) {
      expect(gridFor(ceiling)).toContain(1);
    }
  });

  test('nothing is drawn above the ceiling', () => {
    for (const ceiling of [3, 20, 250, 5000]) {
      for (const line of gridFor(ceiling)) {
        expect(line).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  test('the axis never crowds past eight lines', () => {
    for (const ceiling of [2, 5, 50, 500, 5000]) {
      expect(gridFor(ceiling).length).toBeLessThanOrEqual(8);
    }
  });

  test('a tall ceiling drops the crushed low end rather than the top', () => {
    const lines = gridFor(5000);
    expect(lines).toContain(1);
    expect(lines).toContain(5000);
    // 1.5x under a 5000x ceiling would label three pixels.
    expect(lines).not.toContain(1.5);
  });

  test('every line is in ascending order', () => {
    for (const ceiling of [10, 100, 5000]) {
      const lines = gridFor(ceiling);
      expect([...lines].sort((a, b) => a - b)).toEqual([...lines]);
    }
  });
});

describe('the horizontal mapping', () => {
  test('the round starts at the left edge and now is the right edge', () => {
    const scale = scaleAt(800, 400);
    expect(scale.x(0, 5000)).toBeCloseTo(scale.plot.left, 6);
    expect(scale.x(5000, 5000)).toBeCloseTo(scale.plot.right, 6);
  });

  test('the first frame of a round does not divide by zero', () => {
    const scale = scaleAt(800, 400);
    expect(Number.isFinite(scale.x(0, 0))).toBe(true);
  });
});
