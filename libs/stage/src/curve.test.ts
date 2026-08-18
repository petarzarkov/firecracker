import { describe, expect, test } from 'bun:test';
import { pathTo } from './layers/curve.js';
import { createScale, type Insets } from './scale.js';
import type { StagePoint } from './types.js';

const INSETS: Insets = { left: 40, right: 62, top: 20, bottom: 28 };

/** A round as the server records it: one point every 100ms. */
const ticks = (count: number): StagePoint[] =>
  Array.from({ length: count }, (_, i) => ({
    elapsed: i * 100,
    multiplier: Math.exp((i * 100) / 10_000),
  }));

describe('the drawn path', () => {
  /**
   * The snap.
   *
   * The server ticks ten times a second, so drawing the leading edge from the
   * newest *point* moved the line once every six frames at 60fps - and because
   * the horizontal axis is scaled to the round's length, the whole curve jumped
   * sideways each time. The path now ends wherever the client's clock says the
   * round is.
   */
  test('always ends at the interpolated head, not the newest tick', () => {
    const points = ticks(5); // newest is at 400ms
    const head: StagePoint = { elapsed: 437, multiplier: 1.0446 };
    const path = pathTo(points, head);
    expect(path[path.length - 1]).toBe(head);
    expect(path[path.length - 1]?.elapsed).toBeGreaterThan(400);
  });

  test('keeps every recorded point behind the head', () => {
    const points = ticks(5);
    const path = pathTo(points, { elapsed: 450, multiplier: 1.05 });
    expect(path).toHaveLength(points.length + 1);
  });

  /**
   * A tick can land a frame after the clock has already run past it. Kept, the
   * line doubled back on itself for that frame - a visible flick at the tip.
   */
  test('drops points the head has already passed', () => {
    const points = ticks(5);
    const path = pathTo(points, { elapsed: 250, multiplier: 1.025 });
    expect(path.map((p) => p.elapsed)).toEqual([0, 100, 200, 250]);
  });

  test('a head exactly on a tick does not draw that tick twice', () => {
    const path = pathTo(ticks(3), { elapsed: 200, multiplier: 1.02 });
    expect(path.map((p) => p.elapsed)).toEqual([0, 100, 200]);
  });

  test('the first frame of a round is still a path', () => {
    const path = pathTo([], { elapsed: 0, multiplier: 1 });
    expect(path).toHaveLength(1);
  });
});

describe('the horizontal scaling', () => {
  /**
   * The axis is scaled to the head rather than the newest tick, so the round
   * compresses continuously instead of shuffling left ten times a second.
   */
  test('the tip lands on the plot edge at every moment between ticks', () => {
    const scale = createScale(INSETS);
    scale.resize(1104, 652);

    for (const elapsed of [400, 437, 468, 499, 500]) {
      const head: StagePoint = { elapsed, multiplier: 1.04 };
      expect(scale.x(head.elapsed, head.elapsed)).toBeCloseTo(
        scale.plot.right,
        6,
      );
    }
  });

  /**
   * The real test of smoothness: between two consecutive ticks, a point's x
   * should creep back by a *little* on every frame. Scaled to the newest tick it
   * did not move at all for six frames and then jumped.
   */
  test('an older point drifts left smoothly, never in steps', () => {
    const scale = createScale(INSETS);
    scale.resize(1104, 652);

    const marker = 1000;
    const xs: number[] = [];
    // One 100ms tick interval, sampled at 60fps.
    for (let frame = 0; frame <= 6; frame++) {
      xs.push(scale.x(marker, 4000 + frame * 16.7));
    }

    const steps = xs.slice(1).map((x, i) => (xs[i] as number) - x);
    for (const step of steps) {
      expect(step).toBeGreaterThan(0); // always moving
      expect(step).toBeLessThan(2); // never jumping
    }
    // Every frame moves by about the same amount, which is what smooth means.
    const biggest = Math.max(...steps);
    const smallest = Math.min(...steps);
    expect(biggest - smallest).toBeLessThan(0.05);
  });
});

describe('the plotted curve', () => {
  const curveAt = (ms: number) => Math.exp(ms / 10_000);
  const head: StagePoint = { elapsed: 4000, multiplier: curveAt(4000) };

  /**
   * The stairs.
   *
   * The server pays in integer hundredths, so every multiplier it records is a
   * multiple of 0.01 - about eight vertical pixels early in a round. Joining
   * those samples gives a line whose segments kink between two slopes however
   * smoothly the tip is interpolated, because the stepping is in the values
   * rather than in their timing.
   */
  test('is sampled from the curve, not from the rounded ticks', () => {
    const rounded = ticks(40).map((p) => ({
      ...p,
      multiplier: Math.floor(p.multiplier * 100) / 100,
    }));

    const onGrid = (path: readonly StagePoint[]) =>
      path.every(
        (p) =>
          Math.abs(p.multiplier * 100 - Math.round(p.multiplier * 100)) < 1e-9,
      );

    // Everything the joined path draws sits on the 0.01 grid; the sampled one
    // is free of it.
    expect(onGrid(pathTo(rounded, head).slice(0, -1))).toBe(true);
    expect(onGrid(pathTo(rounded, head, curveAt, 200).slice(0, -1))).toBe(
      false,
    );
  });

  /**
   * The kink, measured. Between consecutive segments the joined path's slope
   * jumps around because each rise is snapped to a whole hundredth; the sampled
   * path's barely changes, which is what an arc looks like.
   */
  test('its segments do not change slope from one to the next', () => {
    const rounded = ticks(40).map((p) => ({
      ...p,
      multiplier: Math.floor(p.multiplier * 100) / 100,
    }));

    const slopeSpread = (path: readonly StagePoint[]) => {
      const slopes = path.slice(1).map((p, i) => {
        const previous = path[i] as StagePoint;
        return (
          (p.multiplier - previous.multiplier) / (p.elapsed - previous.elapsed)
        );
      });
      const kinks = slopes
        .slice(1)
        .map((slope, i) => Math.abs(slope - (slopes[i] as number)));
      return Math.max(...kinks) / (slopes[0] as number);
    };

    // Worst kink as a fraction of the opening slope: a fifth of it when the
    // points are joined, a thousandth when the curve is sampled.
    expect(slopeSpread(pathTo(rounded, head))).toBeGreaterThan(0.1);
    expect(slopeSpread(pathTo(rounded, head, curveAt, 200))).toBeLessThan(0.01);
  });

  test('every sample lies on the curve', () => {
    for (const point of pathTo([], head, curveAt, 64)) {
      expect(point.multiplier).toBeCloseTo(curveAt(point.elapsed), 9);
    }
  });

  test('it starts at the launch and ends exactly on the head', () => {
    const path = pathTo([], head, curveAt, 50);
    expect(path[0]?.elapsed).toBe(0);
    expect(path[0]?.multiplier).toBeCloseTo(1, 9);
    expect(path[path.length - 1]).toBe(head);
  });

  test('the sample count is honoured', () => {
    expect(pathTo([], head, curveAt, 12)).toHaveLength(12);
    expect(pathTo([], head, curveAt, 240)).toHaveLength(240);
  });

  test('without a curve it still joins the recorded points', () => {
    const path = pathTo(ticks(4), head);
    expect(path).toHaveLength(5);
  });

  test('a round that has not started yet falls back to the points', () => {
    const zero: StagePoint = { elapsed: 0, multiplier: 1 };
    expect(pathTo([], zero, curveAt, 100)).toHaveLength(1);
  });
});
