import { Container, Graphics } from 'pixi.js';
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
const FILL_TOP_ALPHA = 0.25;
const TIP_HALO_RADIUS = 7;
const TIP_RADIUS = 4;

export interface Curve {
  readonly view: Container;
  update(scale: Scale, points: readonly StagePoint[], crashed: boolean): void;
  clear(): void;
}

export const createCurve = (): Curve => {
  const view = new Container();
  const graphics = new Graphics();
  view.addChild(graphics);

  const trace = (
    g: Graphics,
    scale: Scale,
    points: readonly StagePoint[],
    span: number,
  ): void => {
    const first = points[0] as StagePoint;
    g.moveTo(scale.x(first.elapsed, span), scale.y(first.multiplier));
    for (let i = 1; i < points.length; i++) {
      const point = points[i] as StagePoint;
      g.lineTo(scale.x(point.elapsed, span), scale.y(point.multiplier));
    }
  };

  return {
    view,

    clear(): void {
      graphics.clear();
    },

    update(scale, points, crashed): void {
      graphics.clear();
      if (points.length < 2) return;

      const colour = crashed ? palette.CURVE_CRASHED : palette.CURVE;
      const { plot } = scale;
      const last = points[points.length - 1] as StagePoint;
      const span = last.elapsed;
      const tipX = scale.x(last.elapsed, span);
      const tipY = scale.y(last.multiplier);

      // The area under the round. A flat translucent fill rather than a vertical
      // gradient: PIXI would need a texture for the gradient, and at this alpha
      // the difference is not visible over the starfield.
      trace(graphics, scale, points, span);
      graphics
        .lineTo(tipX, plot.bottom)
        .lineTo(plot.left, plot.bottom)
        .closePath()
        .fill({ color: colour, alpha: FILL_TOP_ALPHA });

      trace(graphics, scale, points, span);
      graphics.stroke({
        width: GLOW_WIDTH,
        color: colour,
        alpha: GLOW_ALPHA,
        cap: 'round',
        join: 'round',
      });

      trace(graphics, scale, points, span);
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
