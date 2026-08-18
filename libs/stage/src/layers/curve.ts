import { Container, FillGradient, Graphics } from 'pixi.js';
import * as palette from '../palette.js';
import type { Scale } from '../scale.js';
import type { StagePoint } from '../types.js';

/**
 * The round itself: a filled area under a stroked line, with a lit dot at the
 * live end.
 *
 * The glow is a second, fatter, translucent stroke of the same path rather than
 * `shadowBlur`. The canvas version set `shadowBlur = 12` on a stroke covering
 * every point of the round, which is one of the most expensive things a 2D
 * context can be asked to do and got more expensive the longer a player was
 * winning. Two strokes are two draw calls at any length.
 */

const LINE_WIDTH = 3;
const GLOW_WIDTH = 9;
const GLOW_ALPHA = 0.22;
/** Plot pixels between plotted samples. */
const PIXELS_PER_SAMPLE = 5;

const TIP_HALO_RADIUS = 7;
const TIP_RADIUS = 4;

/**
 * The area under the round: strongest at the curve, gone by the axis.
 *
 * A flat fill was tried first and it was wrong - by 3x the round covers most of
 * the plot, and a uniform slab of orange buries the starfield and flattens the
 * shape into a wedge. The fade is what keeps the line reading as the subject.
 *
 * `textureSpace: 'local'` maps the gradient across the shape's own bounds, which
 * is what makes it track a plot that resizes and an axis that rescales without
 * anything recomputing coordinates.
 */
const fadeUnder = (colour: number): FillGradient => {
  // A stop is `{ offset, color }` with no alpha of its own, so the alpha rides
  // in the colour as an eight-digit hex.
  const at = (alpha: number): string =>
    `#${colour.toString(16).padStart(6, '0')}${Math.round(alpha * 255)
      .toString(16)
      .padStart(2, '0')}`;

  return new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: at(0.34) },
      { offset: 0.55, color: at(0.1) },
      { offset: 1, color: at(0) },
    ],
    textureSpace: 'local',
  });
};

/** Built once each; a new gradient per frame would upload a texture per frame. */
const RISING_FILL = fadeUnder(palette.CURVE);
const CRASHED_FILL = fadeUnder(palette.CURVE_CRASHED);

/**
 * The points to draw, oldest first, always ending at `head`.
 *
 * Pure, and separate from the drawing, because this is where the round's shape
 * is decided and the drawing needs a DOM to test. Two things happen here:
 *
 *  - the interpolated `head` is appended, so the line grows between the server's
 *    ten-a-second ticks instead of stepping to each one, and
 *  - any recorded point the head has already passed is dropped, because the
 *    newest tick can arrive a frame after the client's clock has run beyond it
 *    and the line would double back on itself for that frame.
 */
export const pathTo = (
  points: readonly StagePoint[],
  head: StagePoint,
  curveAt?: ((elapsedMs: number) => number) | undefined,
  samples = 0,
): readonly StagePoint[] => {
  if (curveAt !== undefined && samples >= 2 && head.elapsed > 0) {
    // Plotted at screen resolution rather than at the server's tick rate, so
    // the line is limited by pixels instead of by 0.01 steps.
    const path: StagePoint[] = [];
    for (let i = 0; i < samples; i++) {
      const elapsed = (head.elapsed * i) / (samples - 1);
      path.push({ elapsed, multiplier: curveAt(elapsed) });
    }
    // The last sample is the head exactly, so the tip, the rocket and the
    // readout cannot disagree about where the round has got to.
    path[samples - 1] = head;
    return path;
  }

  const path: StagePoint[] = [];
  for (const point of points) {
    if (point.elapsed >= head.elapsed) break;
    path.push(point);
  }
  path.push(head);
  return path;
};

export interface Curve {
  readonly view: Container;
  /**
   * `head` is where the round is *now*, interpolated between server ticks. It is
   * drawn as the last segment of the path so the line grows continuously rather
   * than in ten steps a second.
   */
  update(
    scale: Scale,
    points: readonly StagePoint[],
    head: StagePoint,
    crashed: boolean,
    curveAt?: ((elapsedMs: number) => number) | undefined,
  ): void;
  clear(): void;
}

export const createCurve = (): Curve => {
  const view = new Container();
  const graphics = new Graphics();
  view.addChild(graphics);

  const trace = (
    g: Graphics,
    scale: Scale,
    path: readonly StagePoint[],
    span: number,
  ): void => {
    const first = path[0] as StagePoint;
    g.moveTo(scale.x(first.elapsed, span), scale.y(first.multiplier));
    for (let i = 1; i < path.length; i++) {
      const point = path[i] as StagePoint;
      g.lineTo(scale.x(point.elapsed, span), scale.y(point.multiplier));
    }
  };

  return {
    view,

    clear(): void {
      graphics.clear();
    },

    update(scale, points, head, crashed, curveAt): void {
      graphics.clear();
      if (points.length === 0) return;

      const colour = crashed ? palette.CURVE_CRASHED : palette.CURVE;
      const { plot } = scale;
      // Scaled to the interpolated head, not the newest point. Using the point
      // made the whole curve shuffle left ten times a second as the axis
      // rescaled in steps; against a clock it compresses continuously.
      const span = head.elapsed;
      // One sample per few pixels of plot: past that the segments are shorter
      // than the line is wide and the extra geometry buys nothing.
      const path = pathTo(
        points,
        head,
        curveAt,
        Math.max(2, Math.round(plot.width / PIXELS_PER_SAMPLE)),
      );
      const tipX = scale.x(head.elapsed, span);
      const tipY = scale.y(head.multiplier);

      trace(graphics, scale, path, span);
      graphics
        .lineTo(tipX, plot.bottom)
        .lineTo(plot.left, plot.bottom)
        .closePath()
        .fill(crashed ? CRASHED_FILL : RISING_FILL);

      trace(graphics, scale, path, span);
      graphics.stroke({
        width: GLOW_WIDTH,
        color: colour,
        alpha: GLOW_ALPHA,
        cap: 'round',
        join: 'round',
      });

      trace(graphics, scale, path, span);
      graphics.stroke({
        width: LINE_WIDTH,
        color: colour,
        cap: 'round',
        join: 'round',
      });

      graphics
        .circle(tipX, tipY, TIP_HALO_RADIUS)
        .fill({ color: colour, alpha: 0.3 })
        .circle(tipX, tipY, TIP_RADIUS)
        .fill({ color: colour });
    },
  };
};
