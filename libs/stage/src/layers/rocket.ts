import { Assets, Container, Sprite, type Texture } from 'pixi.js';

/**
 * The firecracker itself.
 *
 * ## It flies now
 *
 * It used to be an `<img>` centred over the canvas by CSS, and the canvas found
 * its wick by calling `getBoundingClientRect()` on the DOM node **every frame** to
 * reconcile two coordinate systems. It also never moved: the round climbed and the
 * rocket sat in the middle of the screen with sparks coming off it.
 *
 * As a sprite in the same scene as the curve there is one coordinate system, no
 * layout read on the render path, and it can do the obvious thing - ride the tip.
 */

/**
 * Where the wick sits relative to the sprite's centre, as a fraction of its size.
 * Measured off the asset; the sparks and the halo hang from here.
 */
const WICK_OFFSET_X = -0.16;
const WICK_OFFSET_Y = 0.39;

const WAITING_SIZE = 90;
const RUNNING_SIZE = 120;

/** How far the rocket leans into the climb, at most. Radians. */
const MAX_TILT = 0.55;

export interface Rocket {
  readonly view: Container;
  /** Point it at `(x, y)`, leaning by `slope` (dy/dx of the curve, screen space). */
  place(x: number, y: number, slope: number, running: boolean): void;
  hide(): void;
  /** The lit end, in stage coordinates. Valid after {@link place}. */
  readonly wickX: number;
  readonly wickY: number;
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
  if (sprite !== null) {
    sprite.anchor.set(0.5);
    sprite.visible = false;
    view.addChild(sprite);
  }

  let wickX = 0;
  let wickY = 0;

  return {
    view,

    get wickX() {
      return wickX;
    },
    get wickY() {
      return wickY;
    },

    place(x, y, slope, running): void {
      const size = running ? RUNNING_SIZE : WAITING_SIZE;

      // `atan` rather than `atan2`: the tilt is a lean, not a heading. A rocket
      // that rotated to follow the curve exactly would be lying on its side by
      // the time the round went vertical.
      const tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.atan(-slope)));

      if (sprite !== null) {
        sprite.visible = true;
        sprite.x = x;
        sprite.y = y;
        sprite.rotation = tilt;
        sprite.width = size;
        sprite.height = size;
        sprite.alpha = running ? 1 : 0.75;
      }

      // The wick offset rotates with the sprite, or the sparks would detach from
      // it the moment it leans.
      const ox = WICK_OFFSET_X * size;
      const oy = WICK_OFFSET_Y * size;
      const cos = Math.cos(tilt);
      const sin = Math.sin(tilt);
      wickX = x + ox * cos - oy * sin;
      wickY = y + ox * sin + oy * cos;
    },

    hide(): void {
      if (sprite !== null) sprite.visible = false;
    },
  };
};
