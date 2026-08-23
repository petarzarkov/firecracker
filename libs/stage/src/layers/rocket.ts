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
 * The wait, which is the longest thing a player watches.
 *
 * The rocket used to be *placed* during the betting window - one `place()` call
 * with the same arguments every frame - so for the whole countdown the screen held
 * a still image with a lit fuse on it. Twenty seconds of nothing is where a lobby
 * loses people.
 *
 * So it hovers: a slow bob and a sway that never quite repeat together, and then a
 * strain that builds over the last seconds into a rumble and a lift. The
 * countdown's numbers are in the DOM over the top - this is what makes them mean
 * something before they run out.
 */
const IDLE_BOB = 7;
const IDLE_BOB_RATE = 0.041;
const IDLE_SWAY = 0.06;
/**
 * Deliberately not a multiple of {@link IDLE_BOB_RATE}: two harmonics beat against
 * each other and the hover never looks like a loop, which a single sine does within
 * about two seconds.
 */
const IDLE_SWAY_RATE = 0.023;

/** How long before the launch the rocket starts straining, in milliseconds. */
const TENSION_MS = 4000;

/** The rumble at full tension, in pixels of jitter. */
const RUMBLE = 3.4;

/** How far it strains upward off its resting point, in pixels. */
const TENSION_LIFT = 18;

/**
 * The lurch as somebody climbs aboard, as a spring: a shove down, and a settle. A
 * one-frame offset is a glitch, and an eased dip-and-return needs a timer per
 * boarder - a spring takes both from one impulse, and two boarders landing together
 * simply push it harder.
 */
const BOARD_KICK = 1.5;
const BOARD_STIFFNESS = 0.055;
const BOARD_DAMPING = 0.16;
/** Past this the spring is at rest, and left there rather than ringing forever. */
const BOARD_REST = 0.05;

/**
 * How hard the rocket is straining, `0` early in the window and `1` at the launch.
 *
 * Squared where it is used rather than here: this is the shape of the wait, and the
 * fuse reads it too.
 */
export const tensionAt = (msLeft: number | null | undefined): number => {
  if (msLeft === null || msLeft === undefined) return 0;
  if (msLeft <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - msLeft / TENSION_MS));
};

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
  place(x: number, y: number, slope: number, delta: number): void;
  /**
   * Hold it over `(x, y)` while the round is still taking bets, straining by
   * `tension` - see {@link tensionAt}. It draws itself somewhere near that point
   * rather than on it, which is the whole difference from {@link place}.
   */
  idle(x: number, y: number, tension: number, delta: number): void;
  /** Somebody got in. `count` is how many landed on this frame. */
  recoil(count: number): void;
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

  let bobAt = 0;
  let swayAt = 0;
  /** The boarding spring: how far it is shoved down, and how fast. */
  let dip = 0;
  let dipV = 0;

  let tumbleLeft = 0;
  let tumbleVx = 0;
  let tumbleVy = 0;
  let tumbleSpin = 0;

  /**
   * Draws it at `(x, y)` and puts the fuse where the artwork says it is. The climb
   * and the hover differ in *where* they put it and in nothing else, and the fuse
   * offsets are the half that is easy to update in one place and forget in the
   * other.
   */
  const draw = (x: number, y: number, height: number, alpha: number): void => {
    drawnX = x;
    drawnY = y;
    const width = height * aspect;

    if (sprite !== null) {
      sprite.visible = true;
      sprite.x = x;
      sprite.y = y;
      sprite.rotation = tilt;
      sprite.width = width;
      sprite.height = height;
      sprite.alpha = alpha;
    }

    // The offsets are fractions of each dimension, and they rotate with the
    // sprite - or the sparks would detach from the fuse the moment it leans.
    const ox = WICK_OFFSET_X * width;
    const oy = WICK_OFFSET_Y * height;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    wickX = x + ox * cos - oy * sin;
    wickY = y + ox * sin + oy * cos;
  };

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

    place(x, y, slope, delta): void {
      /**
       * `atan`, not `atan2`: the tilt is a lean, not a heading - following the curve
       * exactly would have it lying on its side by the time the round went vertical.
       * Eased, because the slope is measured over a few server ticks and snapping to
       * it made the rocket twitch ten times a second.
       */
      const wanted = Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.atan(-slope)));
      tilt += (wanted - tilt) * Math.min(1, TILT_EASE * delta);

      draw(x, y, RUNNING_HEIGHT, 1);
    },

    idle(x, y, tension, delta): void {
      bobAt += IDLE_BOB_RATE * delta;
      swayAt += IDLE_SWAY_RATE * delta;

      // Stepped every frame rather than only while somebody is boarding: this is
      // what carries the last lurch back to rest.
      dipV += (-BOARD_STIFFNESS * dip - BOARD_DAMPING * dipV) * delta;
      dip += dipV * delta;
      if (Math.abs(dip) < BOARD_REST && Math.abs(dipV) < BOARD_REST) {
        dip = 0;
        dipV = 0;
      }

      // Squared, so the whole build-up happens in the last second or so of the
      // window rather than creeping across all of it.
      const strain = tension ** 2;
      // The hover flattens as the strain takes over: it is being held down now,
      // not floating.
      const bob = Math.sin(bobAt) * IDLE_BOB * (1 - strain * 0.7);
      const rumble = RUMBLE * strain;

      // Straightening as it tenses, so the moment before a launch is the one
      // instant in the window it is dead level.
      const wanted = Math.sin(swayAt) * IDLE_SWAY * (1 - strain);
      tilt += (wanted - tilt) * Math.min(1, TILT_EASE * delta);

      draw(
        x + (Math.random() - 0.5) * 2 * rumble,
        y +
          bob +
          dip -
          TENSION_LIFT * strain +
          (Math.random() - 0.5) * 2 * rumble,
        WAITING_HEIGHT,
        0.85 + 0.15 * tension,
      );
    },

    recoil(count): void {
      // Capped: a burst of bots betting on the same frame should shove it, not
      // launch it.
      dipV += BOARD_KICK * Math.min(count, 3);
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
      dip = 0;
      dipV = 0;
    },
  };
};
