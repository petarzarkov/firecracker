import { Assets, Container, Sprite, type Texture } from 'pixi.js';

/**
 * The firecracker itself: a sprite in the same scene as the curve rather than an
 * `<img>` over the canvas, so there is one coordinate system and no
 * `getBoundingClientRect()` on the render path. The offsets below are measured off
 * the artwork, so they belong with it - see the note in the SVG.
 */

/**
 * The fuse tip, as a fraction of the sprite from its centre. Measured from the
 * SVG: the fuse ends at (26, 205) in a 96x224 viewBox whose centre is (48, 112).
 */
const WICK_OFFSET_X = (26 - 48) / 96;
const WICK_OFFSET_Y = (205 - 112) / 224;

/** Drawn height. Width follows from the artwork's aspect. */
const WAITING_HEIGHT = 118;
const RUNNING_HEIGHT = 150;

/** How far the rocket leans into the climb, at most. Radians. */
const MAX_TILT = 0.55;

/** How fast the lean catches up, per 60fps frame. */
const TILT_EASE = 0.12;

export interface Rocket {
  readonly view: Container;
  /** Point it at `(x, y)`, leaning by `slope` (dy/dx of the curve, screen space). */
  place(
    x: number,
    y: number,
    slope: number,
    running: boolean,
    delta: number,
  ): void;
  hide(): void;
  /** The lit end, in stage coordinates. Valid after {@link place}. */
  readonly wickX: number;
  readonly wickY: number;
  /** The body's current lean, so the flame can hang along it. */
  readonly angle: number;
  /**
   * Where it was last drawn - not the curve's tip, which the sprite is nudged off
   * near the axis ceiling. The explosion happens where the player watched the rocket
   * be, not where the arithmetic put its tip.
   */
  readonly x: number;
  readonly y: number;
}

/**
 * Loads the sprite. Resolves to a rocket that draws nothing if the asset is
 * missing - a decoration failing to load is not a reason for the round to.
 */
export const createRocket = async (url?: string): Promise<Rocket> => {
  const view = new Container();

  let texture: Texture | null = null;
  if (url !== undefined) {
    texture = await Assets.load<Texture>(url).catch(() => null);
  }

  const sprite = texture === null ? null : new Sprite(texture);
  const aspect =
    texture === null || texture.height === 0
      ? 1
      : texture.width / texture.height;

  if (sprite !== null) {
    sprite.anchor.set(0.5);
    sprite.visible = false;
    view.addChild(sprite);
  }

  let wickX = 0;
  let wickY = 0;
  let tilt = 0;
  let drawnX = 0;
  let drawnY = 0;

  return {
    view,

    get wickX() {
      return wickX;
    },
    get wickY() {
      return wickY;
    },
    get angle() {
      return tilt;
    },
    get x() {
      return drawnX;
    },
    get y() {
      return drawnY;
    },

    place(x, y, slope, running, delta): void {
      drawnX = x;
      drawnY = y;
      const height = running ? RUNNING_HEIGHT : WAITING_HEIGHT;
      const width = height * aspect;

      /**
       * `atan`, not `atan2`: the tilt is a lean, not a heading - following the curve
       * exactly would have it lying on its side by the time the round went vertical.
       * Eased, because the slope is measured over a few server ticks and snapping to
       * it made the rocket twitch ten times a second.
       */
      const wanted = Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.atan(-slope)));
      tilt += (wanted - tilt) * Math.min(1, TILT_EASE * delta);

      if (sprite !== null) {
        sprite.visible = true;
        sprite.x = x;
        sprite.y = y;
        sprite.rotation = tilt;
        sprite.width = width;
        sprite.height = height;
        sprite.alpha = running ? 1 : 0.85;
      }

      // The offsets are fractions of each dimension, and they rotate with the
      // sprite - or the sparks would detach from the fuse the moment it leans.
      const ox = WICK_OFFSET_X * width;
      const oy = WICK_OFFSET_Y * height;
      const cos = Math.cos(tilt);
      const sin = Math.sin(tilt);
      wickX = x + ox * cos - oy * sin;
      wickY = y + ox * sin + oy * cos;
    },

    hide(): void {
      if (sprite !== null) sprite.visible = false;
      tilt = 0;
    },
  };
};
