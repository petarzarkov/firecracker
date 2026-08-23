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

/**
 * The wreck, after the fuse runs out.
 *
 * The rocket used to be `hide()`den on the frame the round crashed, so the thing a
 * player had spent thirty seconds watching climb left the screen between two
 * frames and the explosion happened over an empty patch of plot. It reads as a
 * glitch rather than as a loss.
 *
 * So it is thrown instead: kicked up and sideways, spinning, and pulled back down
 * by a gravity heavier than the blast's so it clears the frame while the fireball
 * is still open. Long enough to follow, short enough to be gone before the next
 * round's countdown starts.
 */
const TUMBLE_FRAMES = 52;
/** The upward kick, in pixels per frame. Negative is up. */
const TUMBLE_LIFT = -4.6;
const TUMBLE_DRIFT = 3.6;
const TUMBLE_GRAVITY = 0.36;
/** Radians per frame. Fast enough to read as end-over-end, not as a blur. */
const TUMBLE_SPIN = 0.19;
/** What is left of it by the time it stops being drawn. */
const TUMBLE_MIN_SCALE = 0.55;

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
  /**
   * Blow it off the curve. It keeps drawing itself from here - through
   * {@link tumble} - rather than being placed, until the tumble runs out.
   */
  burst(): void;
  /** Advance the tumble. A no-op once it has finished, or if it never started. */
  tumble(delta: number): void;
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

  let tumbleLeft = 0;
  let tumbleVx = 0;
  let tumbleVy = 0;
  let tumbleSpin = 0;

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

    burst(): void {
      if (sprite === null) return;
      tumbleLeft = TUMBLE_FRAMES;
      // Sideways is random rather than "the way it was going": a crash is the
      // round stopping, and throwing the wreck along the climb reads as it
      // carrying on.
      tumbleVx = (Math.random() - 0.5) * 2 * TUMBLE_DRIFT;
      tumbleVy = TUMBLE_LIFT;
      tumbleSpin = (Math.random() < 0.5 ? -1 : 1) * TUMBLE_SPIN;
      sprite.visible = true;
    },

    tumble(delta): void {
      if (sprite === null || tumbleLeft <= 0) return;

      tumbleLeft = Math.max(0, tumbleLeft - delta);
      tumbleVy += TUMBLE_GRAVITY * delta;
      drawnX += tumbleVx * delta;
      drawnY += tumbleVy * delta;

      const remaining = tumbleLeft / TUMBLE_FRAMES;
      sprite.x = drawnX;
      sprite.y = drawnY;
      sprite.rotation += tumbleSpin * delta;
      // Squared, so it stays legible through the fireball and then goes quickly
      // rather than hanging around as a ghost over the next countdown.
      sprite.alpha = remaining ** 2;
      const height =
        RUNNING_HEIGHT *
        (TUMBLE_MIN_SCALE + (1 - TUMBLE_MIN_SCALE) * remaining);
      sprite.height = height;
      sprite.width = height * aspect;

      if (tumbleLeft === 0) sprite.visible = false;
    },

    hide(): void {
      if (sprite !== null) sprite.visible = false;
      tilt = 0;
      tumbleLeft = 0;
    },
  };
};
