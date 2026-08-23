import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { type Complaints, launch, openPage, shoot } from './browser.js';
import { type Harness, serveHarness } from './harness.js';
import type { Cell, HarnessRound, StageHarness } from './stage.entry.js';

/**
 * The round as it is actually drawn, in a real browser, on a real GPU stack.
 *
 * Everything else about this chart is tested through its arithmetic - the scale's
 * geometry, the boarding arc, the fuse's heat - and arithmetic cannot say whether
 * anything reached the screen. These do: they step the stage a frame at a time,
 * read the drawing buffer back, and leave a picture behind for a person.
 *
 * Deterministic by construction, so a screenshot means the same thing twice: the
 * clock only moves when a test says so and `Math.random` is seeded. See `clock.ts`.
 */

const SIZE = { width: 900, height: 520 };

/** A frame, in the units the stage counts: `advance(60)` is one second. */
const SECOND = 60;

interface Harnessed {
  __harness: StageHarness;
}

const ready = (page: Page): Promise<void> =>
  page.evaluate(() => (globalThis as unknown as Harnessed).__harness.ready);

const set = (page: Page, next: Partial<HarnessRound>): Promise<void> =>
  page.evaluate(
    (patch) => (globalThis as unknown as Harnessed).__harness.set(patch),
    next,
  );

const advance = (page: Page, frames: number): Promise<void> =>
  page.evaluate(
    (count) => (globalThis as unknown as Harnessed).__harness.advance(count),
    frames,
  );

const board = (page: Page, name: string, cents: number): Promise<void> =>
  page.evaluate(
    ([who, amount]) =>
      (globalThis as unknown as Harnessed).__harness.board(
        who as string,
        amount as number,
      ),
    [name, cents] as const,
  );

const cashOut = (
  page: Page,
  name: string,
  at: number,
  cents: number,
): Promise<void> =>
  page.evaluate(
    ([who, multiplier, payout]) =>
      (globalThis as unknown as Harnessed).__harness.cashOut(
        who as string,
        multiplier as number,
        payout as number,
      ),
    [name, at, cents] as const,
  );

/**
 * Steps `frames` and reads the buffer back **in one call**, which is not a
 * convenience: WebGL only guarantees the drawing buffer's contents until the end of
 * the task that drew them, so a read in a second `evaluate` can come back cleared.
 */
const frameAfter = (
  page: Page,
  frames: number,
  cols: number,
  rows: number,
): Promise<Cell[]> =>
  page.evaluate(
    ([count, c, r]) => {
      const harness = (globalThis as unknown as Harnessed).__harness;
      harness.advance(count as number);
      return harness.grid(c as number, r as number);
    },
    [frames, cols, rows] as const,
  );

const GRID = { cols: 24, rows: 16 } as const;

/**
 * A box of the canvas, as fractions of it: `{ x0: 0.4, x1: 0.6 }` is the middle
 * fifth. Fractions rather than cell indices so an assertion says where it is
 * looking, and so changing {@link GRID} does not silently move every box.
 */
interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** Steps `frames` and reads one scanline back, in one call - see {@link frameAfter}. */
const scanAfter = (page: Page, frames: number, at: number): Promise<number[]> =>
  page.evaluate(
    ([count, where]) => {
      const harness = (globalThis as unknown as Harnessed).__harness;
      harness.advance(count as number);
      return harness.row(where as number);
    },
    [frames, at] as const,
  );

/** The sharpest one-pixel change anywhere in `from`..`to` of a scanline's width. */
const sharpestStep = (
  line: readonly number[],
  from: number,
  to: number,
): number => {
  let worst = 0;
  for (
    let x = Math.floor(from * line.length) + 1;
    x < Math.min(line.length - 1, to * line.length);
    x++
  ) {
    worst = Math.max(
      worst,
      Math.abs((line[x + 1] as number) - (line[x - 1] as number)),
    );
  }
  return worst;
};

/** The average brightness inside `box`, 0-255. */
const region = (cells: readonly Cell[], box: Box): number => {
  const col0 = Math.floor(box.x0 * GRID.cols);
  const col1 = Math.max(col0 + 1, Math.ceil(box.x1 * GRID.cols));
  const row0 = Math.floor(box.y0 * GRID.rows);
  const row1 = Math.max(row0 + 1, Math.ceil(box.y1 * GRID.rows));

  let total = 0;
  let count = 0;
  for (let row = row0; row < row1; row++) {
    for (let col = col0; col < col1; col++) {
      total += (cells[row * GRID.cols + col] as Cell).light;
      count++;
    }
  }
  return total / Math.max(1, count);
};

/**
 * The brightest cell on the canvas, as fractions of it.
 *
 * Better than a ratio of two averages for "is the rocket there": a box big enough
 * to hold the rocket is mostly empty plot, so its average is gridlines with a
 * rocket's worth of light stirred into it - which is how the first version of this
 * assertion came out at 17.9 against a threshold of 20.1 while the screenshot beside
 * it showed a perfectly good rocket.
 */
const brightest = (
  cells: readonly Cell[],
): { x: number; y: number; light: number } => {
  let index = 0;
  cells.forEach((cell, at) => {
    if (cell.light > (cells[index] as Cell).light) index = at;
  });
  return {
    x: ((index % GRID.cols) + 0.5) / GRID.cols,
    y: (Math.floor(index / GRID.cols) + 0.5) / GRID.rows,
    light: (cells[index] as Cell).light,
  };
};

/** Where the rocket hovers through the betting window. */
const ROCKET: Box = { x0: 0.44, x1: 0.56, y0: 0.3, y1: 0.68 };
/** The pad: where a boarder launches from and crosses on its way up. */
const PAD: Box = { x0: 0.25, x1: 0.8, y0: 0.62, y1: 1 };

/** The whole frame, for "did anything at all get drawn". */
const everything = (cells: readonly Cell[]): number =>
  cells.reduce((sum, cell) => sum + cell.light, 0) / cells.length;

describe('the stage, drawn', () => {
  let browser: Browser;
  let harness: Harness;

  beforeAll(async () => {
    [browser, harness] = await Promise.all([launch(), serveHarness()]);
  });

  afterAll(async () => {
    await Promise.all([browser?.close(), harness?.stop()]);
  });

  /** A fresh page per test: one stage, one seeded clock, nothing carried over. */
  const open = async (
    scale = 1,
  ): Promise<{ page: Page; complaints: Complaints }> => {
    const opened = await openPage(browser, SIZE, { clock: 'stepped', scale });
    await opened.page.goto(harness.url);
    // The bundle is a module, so it is still fetching when `goto` resolves.
    await opened.page.waitForFunction("'__harness' in globalThis");
    await ready(opened.page);
    return opened;
  };

  /**
   * The renderer starting at all is the thing this rig exists to prove. The stage's
   * own README records `Application.init()` hanging without resolving *or throwing*
   * on a machine with no usable GPU, which is why `createStage` races it against a
   * timeout - and why nothing below could be trusted if this failed.
   */
  /**
   * The scene fills the canvas on a 2x or 3x display.
   *
   * `renderer.width` is **already CSS pixels** - PIXI stores
   * `Math.round(width * resolution) / resolution` on the texture source and
   * `renderer.width` reads that frame, while the backing store is `canvas.width`.
   * Dividing it by `resolution` again halved every dimension the layers measure in,
   * so the plot drew into the top-left corner of the box and the rest stayed the
   * clear colour - indistinguishable from the container behind it.
   *
   * **At `deviceScaleFactor: 1` the division is a no-op**, which is the whole reason
   * this needs its own case: every other spec here and every desktop run divides by
   * one, so a bug that only exists above 1x was invisible to all of them while being
   * the first thing anybody saw on a phone.
   *
   * `resolution` is capped at 2, so a 3x page renders at 2x deliberately - the point
   * of 3 is that the cap makes the device ratio and the renderer's disagree, which
   * is the case a naive `devicePixelRatio` read would also get wrong.
   */
  test('fills the canvas at 3x, not a quarter of it', async () => {
    const { page, complaints } = await open(3);

    await set(page, { phase: 'running', elapsed: 0 });
    // Long enough for the curve to reach the right-hand edge of the plot, which is
    // where the tip and the rocket are drawn.
    const cells = await frameAfter(page, 4 * SECOND, GRID.cols, GRID.rows);

    console.log('  →', await shoot(page, 'stage-3x'));

    /*
      The rocket, which is far and away the brightest thing drawn, rides the curve's
      leading edge - and that edge is always the plot's right edge, because the
      horizontal axis scales to the round's own length. So where the brightest cell
      is *is* how wide the plot thinks it is.

      With `INSETS.right` at 62 of 900 that puts it at about 0.93. Halved it lands at
      0.43, which is what this pins: a threshold between the two rather than near
      either, so it fails on the bug without being brittle about the sprite's exact
      glow.
    */
    const tip = brightest(cells);
    expect(tip.x).toBeGreaterThan(0.7);

    /*
      And the plot reaches the bottom. `1x` is the baseline the curve leaves from, at
      `height - INSETS.bottom` - about 0.95 down a 520px canvas - so the lowest strip
      holds the gridline and the bright start of the curve. Halved, that strip is
      empty and everything is in the top half.
    */
    expect(region(cells, { x0: 0, x1: 1, y0: 0.9, y1: 1 })).toBeGreaterThan(2);

    expect(complaints.errors).toEqual([]);
    await page.close();
  });

  test('starts a renderer and draws a plot', async () => {
    const { page, complaints } = await open();

    const cells = await frameAfter(page, 30, GRID.cols, GRID.rows);
    expect(everything(cells)).toBeGreaterThan(0);
    console.log('  →', await shoot(page, 'idle'));

    expect(complaints.errors).toEqual([]);
    await page.close();
  });

  test('the betting window holds a lit rocket in the middle of the plot', async () => {
    const { page, complaints } = await open();
    await set(page, { phase: 'waiting', waitingLeft: 9000 });

    const cells = await frameAfter(page, SECOND, GRID.cols, GRID.rows);
    console.log('  →', await shoot(page, 'waiting-early'));

    // The rocket and its lit fuse are the brightest thing on the plot, and they
    // are in the middle of it.
    const spot = brightest(cells);
    expect(spot.x).toBeGreaterThan(0.42);
    expect(spot.x).toBeLessThan(0.58);
    expect(spot.y).toBeGreaterThan(0.25);
    expect(spot.y).toBeLessThan(0.75);

    expect(complaints.errors).toEqual([]);
    await page.close();
  });

  /**
   * The whole point of the wait having a shape. Early in the window the fuse is a
   * small halo; at the launch it has swollen and is throwing sparks, and the rocket
   * has strained upward off its resting point. Before that change this pair of
   * frames was identical bar the starfield.
   */
  test('the fuse burns harder as the countdown runs out', async () => {
    const { page, complaints } = await open();

    await set(page, { phase: 'waiting', waitingLeft: 9000 });
    const early = await frameAfter(page, SECOND, GRID.cols, GRID.rows);

    await set(page, { phase: 'waiting', waitingLeft: 400 });
    const late = await frameAfter(page, SECOND / 2, GRID.cols, GRID.rows);
    console.log('  →', await shoot(page, 'waiting-launch'));

    expect(region(late, ROCKET)).toBeGreaterThan(region(early, ROCKET) * 1.2);

    expect(complaints.errors).toEqual([]);
    await page.close();
  });

  /**
   * A bet, as a player sees it: somebody launches from under the plot, arcs up, and
   * is gone into the hull about a second and a quarter later.
   */
  test('a bet flies a player up to the rocket and leaves nothing behind', async () => {
    const { page, complaints } = await open();
    await set(page, { phase: 'waiting', waitingLeft: 9000 });

    const before = await frameAfter(page, SECOND, GRID.cols, GRID.rows);
    const empty = region(before, PAD);

    await board(page, 'ada', 250);
    const climbing = await frameAfter(page, 30, GRID.cols, GRID.rows);
    console.log('  →', await shoot(page, 'boarding-climbing'));
    expect(region(climbing, PAD)).toBeGreaterThan(empty);

    // The hatch, and the puff of sparks it leaves. The flight is 76 frames.
    await frameAfter(page, 50, GRID.cols, GRID.rows);
    console.log('  →', await shoot(page, 'boarding-aboard'));

    // Back to an empty pad. A pooled sprite left visible would sit here forever,
    // and the pool recycles by index, so the next round would reuse it mid-flight.
    const settled = await frameAfter(page, 2 * SECOND, GRID.cols, GRID.rows);
    expect(region(settled, PAD)).toBeLessThan(empty * 1.3 + 1);

    expect(complaints.errors).toEqual([]);
    await page.close();
  });

  test('a lobby boarding together arrives spread out, not as one silhouette', async () => {
    const { page, complaints } = await open();
    await set(page, { phase: 'waiting', waitingLeft: 8000 });

    for (const [name, cents] of [
      ['ada', 500],
      ['grace', 1250],
      ['alan', 100],
      ['edsger', 2000],
    ] as const) {
      await board(page, name, cents);
    }

    await frameAfter(page, 40, GRID.cols, GRID.rows);
    console.log('  →', await shoot(page, 'boarding-crowd'));

    expect(complaints.errors).toEqual([]);
    await page.close();
  });

  test('a running round climbs, and the rocket rides the tip', async () => {
    const { page, complaints } = await open();
    await set(page, { phase: 'running', elapsed: 0 });

    const cells = await frameAfter(page, 5 * SECOND, GRID.cols, GRID.rows);
    console.log('  →', await shoot(page, 'running'));

    // The curve leaves the bottom left and arrives at the top right, so the top
    // right is lit and the bottom right - under the tip - is not.
    const tip = region(cells, { x0: 0.7, x1: 1, y0: 0.1, y1: 0.6 });
    const under = region(cells, { x0: 0.75, x1: 1, y0: 0.85, y1: 1 });
    expect(tip).toBeGreaterThan(under);

    expect(complaints.errors).toEqual([]);
    await page.close();
  });

  /**
   * The seam.
   *
   * The light under the curve is a fill closed by a vertical drop from the tip to
   * the axis, and its gradient only ran downward - so that closing edge was a hard
   * step from lit plot to unlit, running two hundred pixels down the chart a
   * rocket's width from where every eye already is. It measured 34 against 24 of
   * luminance in one pixel; a smooth falloff over the same stretch measures about
   * four, and most of that is the rocket's own exhaust.
   *
   * Found by looking at `running.png` and disbelieved twice, because a whole-frame
   * assertion cannot see a one-pixel column and neither can a person at 1x.
   */
  test('the light under the curve fades out at the tip, never cuts off', async () => {
    const { page, complaints } = await open();
    await set(page, { phase: 'running', elapsed: 0 });

    // Well below the curve and above the axis, where the fill is the only thing
    // drawn and its closing edge was the brightest thing about it.
    const line = await scanAfter(page, 5 * SECOND, 0.77);
    expect(sharpestStep(line, 0.6, 0.99)).toBeLessThan(6);

    expect(complaints.errors).toEqual([]);
    await page.close();
  });

  test('a cash-out drops somebody under a canopy', async () => {
    const { page, complaints } = await open();
    await set(page, { phase: 'running', elapsed: 0 });
    await advance(page, 3 * SECOND);

    await cashOut(page, 'grace', 1.34, 1675);
    await frameAfter(page, SECOND, GRID.cols, GRID.rows);
    console.log('  →', await shoot(page, 'cash-out'));

    expect(complaints.errors).toEqual([]);
    await page.close();
  });

  /**
   * The crash is the one moment on this chart that is supposed to be violent, and
   * it is staged over about two and a half seconds - so a test that looks once
   * cannot tell a fireball from a flashbulb. This looks at the peak and again after
   * it, and asserts the second is dimmer than the first.
   */
  test('the crash opens a fireball and then fades', async () => {
    const { page, complaints } = await open();
    await set(page, { phase: 'running', elapsed: 0 });
    await advance(page, 4 * SECOND);

    await set(page, { phase: 'crashed' });
    const blast = await frameAfter(page, 12, GRID.cols, GRID.rows);
    console.log('  →', await shoot(page, 'crash-blast'));

    const after = await frameAfter(page, 2 * SECOND, GRID.cols, GRID.rows);
    console.log('  →', await shoot(page, 'crash-after'));

    expect(everything(blast)).toBeGreaterThan(everything(after));

    expect(complaints.errors).toEqual([]);
    await page.close();
  });
});
