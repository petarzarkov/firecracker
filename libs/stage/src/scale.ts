/**
 * The plot's geometry: multiplier to y, elapsed time to x, and the gridlines.
 *
 * **One object, because two declarations of one mapping drift.** With the curve
 * mapped through the chart's real height and the labels positioned by percentage
 * against a hardcoded 360px, the two agreed only on a 360px chart - on a desktop the
 * `1x` label sat 43px below its own gridline, and the error grew with the chart.
 */

/**
 * A ladder rather than "round up the multiplier", so the top gridline is always a
 * number worth printing and the axis does not relabel itself every frame.
 */
const CEILINGS = [
  2, 3, 5, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000,
] as const;

/** Multipliers worth a gridline, in order. The axis draws the ones that fit. */
const NICE = [
  1, 1.5, 2, 3, 5, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000,
] as const;

/** How much of the plot stays empty above the curve. */
const HEADROOM = 1.35;

/** Gridlines drawn at once, at most. `1x` is always one of them. */
const MAX_GRID_LINES = 8;

/** How fast the axis catches up to a new ceiling, per frame. */
const REZOOM_RATE = 0.045;

/** The smallest multiplier the log mapping is defined for. */
const FLOOR = 1;

/**
 * The plot height every sprite in this scene was drawn against - roughly what a
 * desktop chart gets.
 */
const SPRITE_REFERENCE_HEIGHT = 560;

/** How far sprites are allowed to shrink and grow from the sizes in the layers. */
const SPRITE_ZOOM = [0.5, 1.2] as const;

/**
 * How big to draw a sprite, as a multiple of the size its layer declares.
 *
 * Every sprite here was a fixed pixel size - the rocket 150 tall in flight, a
 * canopy 74 wide, a boarding player 58 - which is right on a 1440px desktop and
 * absurd anywhere else. On a 320px phone the rocket was nearly half the plot's
 * height and collided with the multiplier readout, and one cash-out canopy covered
 * the axis labels; on a tall tablet the same rocket was a speck in 790 pixels of
 * empty plot.
 *
 * Driven by height rather than area: the plot is much wider than it is tall at
 * every size this app runs at, so height is what the scene is actually short of.
 */
export const spriteZoom = (height: number): number => {
  const wanted = height / SPRITE_REFERENCE_HEIGHT;
  return Math.max(SPRITE_ZOOM[0], Math.min(SPRITE_ZOOM[1], wanted));
};

export interface Insets {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface Plot {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The first rung leaving {@link HEADROOM} above the multiplier. A round past the
 * last rung does flatten, but at 5000x rather than at the 50x this game sees.
 */
export const ceilingFor = (multiplier: number): number => {
  const wanted = Math.max(FLOOR, multiplier) * HEADROOM;
  for (const rung of CEILINGS) if (rung >= wanted) return rung;
  return CEILINGS[CEILINGS.length - 1] as number;
};

/**
 * `1x` always survives - it is the baseline the curve leaves from. Above it the
 * highest values win, because a log axis crushes the low end and `1.5x` under a
 * 500x ceiling labels three pixels.
 */
export const gridFor = (ceiling: number): readonly number[] => {
  const fits = NICE.filter((value) => value <= ceiling);
  if (fits.length <= MAX_GRID_LINES) return fits;
  return [FLOOR, ...fits.slice(fits.length - (MAX_GRID_LINES - 1))];
};

export interface Scale {
  /** Where a multiplier sits vertically, in canvas pixels. */
  y(multiplier: number): number;
  /** Where a moment sits horizontally. `span` is the round's elapsed time so far. */
  x(elapsed: number, span: number): number;
  /** Move the ceiling if the round has outgrown it. Call once per frame. */
  follow(multiplier: number): void;
  /** Back to the opening ceiling, for the next round. */
  reset(): void;
  resize(width: number, height: number): void;
  readonly plot: Plot;
  /** The ceiling being drawn to, which lags {@link ceilingFor} while it eases. */
  readonly ceiling: number;
  readonly grid: readonly number[];
}

export const createScale = (insets: Insets): Scale => {
  let width = 0;
  let height = 0;
  let logMax = Math.log(CEILINGS[0]);
  let targetLogMax = logMax;
  let grid: readonly number[] = gridFor(CEILINGS[0]);

  const plot = (): Plot => {
    const left = insets.left;
    const top = insets.top;
    const right = Math.max(left, width - insets.right);
    const bottom = Math.max(top, height - insets.bottom);
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  };

  return {
    get plot() {
      return plot();
    },

    get ceiling() {
      return Math.exp(logMax);
    },

    get grid() {
      return grid;
    },

    // A fraction of the plot rather than a pixel count, so resizing cannot make the
    // labels and the lines disagree.
    y(multiplier: number): number {
      const p = plot();
      const norm = Math.min(Math.log(Math.max(FLOOR, multiplier)) / logMax, 1);
      return p.bottom - p.height * norm;
    },

    x(elapsed: number, span: number): number {
      const p = plot();
      return p.left + (elapsed / Math.max(span, 1)) * p.width;
    },

    /**
     * Eases rather than jumps: snapping the frame a round crosses 2x yanks the whole
     * curve down, in the moment the player is watching hardest. It never comes back
     * down inside a round either, or the curve would lie about the round's shape.
     */
    follow(multiplier: number): void {
      const wanted = Math.log(ceilingFor(multiplier));
      if (wanted > targetLogMax) {
        targetLogMax = wanted;
        grid = gridFor(Math.exp(wanted));
      }
      if (logMax < targetLogMax) {
        logMax = Math.min(
          targetLogMax,
          logMax + (targetLogMax - logMax) * REZOOM_RATE + 0.0005,
        );
      }
    },

    reset(): void {
      logMax = Math.log(CEILINGS[0]);
      targetLogMax = logMax;
      grid = gridFor(CEILINGS[0]);
    },

    resize(w: number, h: number): void {
      width = w;
      height = h;
    },
  };
};
