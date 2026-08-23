import { Container, Graphics } from 'pixi.js';
import * as palette from '../palette.js';
import { underCurveTexture } from '../textures.js';
import type { Scale } from '../scale.js';
import type { StagePoint } from '../types.js';

/**
 * The round itself: a filled area under a stroked line, with a lit dot at the live
 * end. The glow is a second, fatter, translucent stroke rather than `shadowBlur` -
 * two draw calls at any length, where a blurred stroke got more expensive the longer
 * a player was winning.
 */

const LINE_WIDTH = 3;
const GLOW_WIDTH = 9;
const GLOW_ALPHA = 0.22;
/** Plot pixels between plotted samples. */
const PIXELS_PER_SAMPLE = 5;

const TIP_HALO_RADIUS = 7;
const TIP_RADIUS = 4;

/**
 * The area under the round: strongest at the curve, gone by the axis, and gone at
 * the leading edge too.
 *
 * It was a two-stop {@link FillGradient} fading downward, which left the closing
 * edge - the vertical drop from the tip to the axis - as a hard step from lit plot
 * to unlit, right beside the rocket where every eye already is. A linear gradient
 * fades in one direction and this shape needs two, so the profile is painted into a
 * texture instead: see `underCurveTexture`. One fill either way.
 *
 * `textureSpace: 'local'` maps it across the shape's own bounds, which is what
 * tracks a resizing plot and a rescaling axis with no recomputed coordinates - and
 * what puts the feather on the tip rather than at some fixed pixel.
 */
const wash = (colour: number) =>
  ({
    texture: underCurveTexture(),
    // The texture is white, so this is a tint. A rising round and a crashed one
    // differ in nothing else.
    color: colour,
    textureSpace: 'local',
  }) as const;

/**
 * The points to draw, oldest first, always ending at `head`. Pure and separate from
 * the drawing, which needs a DOM to test. The interpolated `head` is appended so the
 * line grows between ticks rather than stepping, and any recorded point the head has
 * passed is dropped - a tick can arrive a frame after the client's clock ran beyond
 * it, and the line would double back.
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
        .fill(wash(colour));

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
