import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import * as palette from '../palette.js';

/**
 * The crash, as a sequence rather than as a moment.
 *
 * It used to be two things on one frame - a 26-frame fireball and a `rocket.hide()`
 * - which is about four tenths of a second for the whole event, most of it spent
 * fading. The rocket was simply gone, so there was nothing to watch being destroyed,
 * and the fireball's alpha ran on the *square* of its remaining life, so it was down
 * to a quarter brightness a fifth of a second in. Together that is the "poof".
 *
 * What replaces it is staged, and the stages deliberately overlap: a white core at
 * the point of detonation, a ring leaving it, the fireball opening behind that, and
 * a warm residue that outlives all of it - with the wreck thrown clear by the rocket
 * layer and cinders arcing over from the embers. Nothing here outruns the crashed
 * phase: the server holds it for `GAME_COOLDOWN_MS`, five seconds by default, and
 * the longest thing below is the residue at about two and a third.
 */

/** The white-hot instant. Short on purpose: it is the thing the ring leaves behind. */
const CORE_FRAMES = 14;
const CORE_SIZE = [26, 190] as const;

/** How long the fireball itself lasts, and how wide it opens. */
const BLAST_FRAMES = 66;
const BLAST_SIZE = [44, 470] as const;

/** The pressure ring. Outruns the fireball, which is what gives the blast a scale. */
const SHOCK_FRAMES = 40;
const SHOCK_RADIUS = 430;
const SHOCK_WIDTH = 7;

/** How long the screen stays washed red after a crash, in frames. */
const FLASH_FRAMES = 78;

/** The residue: swells as the fireball dies, then goes. */
const AFTERGLOW_FRAMES = 140;
const AFTERGLOW_SIZE = [240, 540] as const;

/** How long the kick rings for. Its size comes from {@link Motion}. */
const SHAKE_FRAMES = 26;

/**
 * How much of a crash a viewer has asked to see. See `prefers-reduced-motion` in
 * `stage.ts`: the fireball is the event and stays either way, the screen-wide wash
 * and the shake are what get gated.
 */
export interface Motion {
  readonly flash: number;
  readonly shake: number;
}

/** Whole-scene displacement for one frame. */
export interface Shake {
  readonly x: number;
  readonly y: number;
}

export interface Detonation {
  /** Ambient light, drawn under the plot. */
  readonly under: Container;
  /** The fireball itself, drawn over it - see the note at the `addChild` call. */
  readonly over: Container;
  /** Set it off at `(x, y)`, where the player last saw the rocket under power. */
  fire(x: number, y: number): void;
  advance(delta: number, width: number, height: number, motion: Motion): Shake;
  clear(): void;
}

export const createDetonation = (halo: Texture): Detonation => {
  const under = new Container();
  const over = new Container();

  const flash = new Sprite(halo);
  flash.anchor.set(0.5);
  flash.tint = palette.FLASH;
  flash.alpha = 0;

  // The residue, under the plot with the other ambient light.
  const afterglow = new Sprite(halo);
  afterglow.anchor.set(0.5);
  afterglow.tint = palette.AFTERGLOW;
  afterglow.alpha = 0;

  // A hot disc that expands and fades where the rocket actually was, rather than
  // in the middle of the chart box.
  const blast = new Sprite(halo);
  blast.anchor.set(0.5);
  blast.alpha = 0;

  // The white centre of it, and the ring leaving that centre.
  const core = new Sprite(halo);
  core.anchor.set(0.5);
  core.tint = palette.BLAST_CORE;
  core.alpha = 0;

  const shock = new Graphics();

  under.addChild(flash, afterglow);
  over.addChild(blast, shock, core);

  let at = { x: 0, y: 0 };
  let flashLeft = 0;
  let blastLeft = 0;
  let coreLeft = 0;
  let shockLeft = 0;
  let afterglowLeft = 0;
  let shakeLeft = 0;

  return {
    under,
    over,

    fire(x, y): void {
      at = { x, y };
      flashLeft = FLASH_FRAMES;
      blastLeft = BLAST_FRAMES;
      coreLeft = CORE_FRAMES;
      shockLeft = SHOCK_FRAMES;
      afterglowLeft = AFTERGLOW_FRAMES;
      shakeLeft = SHAKE_FRAMES;
    },

    advance(delta, width, height, motion): Shake {
      if (flashLeft > 0) {
        flash.x = at.x;
        flash.y = at.y;
        flash.width = Math.max(width, height) * 2.4;
        flash.height = flash.width;
        flash.alpha = (flashLeft / FLASH_FRAMES) ** 1.3 * motion.flash;
        flashLeft -= delta;
      } else {
        flash.alpha = 0;
      }

      if (blastLeft > 0) {
        const age = 1 - blastLeft / BLAST_FRAMES;
        const size =
          BLAST_SIZE[0] + (BLAST_SIZE[1] - BLAST_SIZE[0]) * Math.sqrt(age);
        blast.x = at.x;
        blast.y = at.y;
        blast.width = size;
        blast.height = size;
        blast.tint = palette.blastTintFor(age);
        /**
         * An attack, then a decay - not a decay alone.
         *
         * Starting at full brightness makes it a flashbulb: the brightest frame is
         * the first one, before it has opened to any size, so what a player sees is a
         * dot and then a fade. Ramping over the first tenth means the peak lands
         * where the fireball is actually big.
         */
        blast.alpha = Math.min(1, age / 0.1) * (1 - age) ** 1.4;
        blastLeft -= delta;
      } else {
        blast.alpha = 0;
      }

      if (coreLeft > 0) {
        const remaining = coreLeft / CORE_FRAMES;
        const size =
          CORE_SIZE[0] +
          (CORE_SIZE[1] - CORE_SIZE[0]) * Math.sqrt(1 - remaining);
        core.x = at.x;
        core.y = at.y;
        core.width = size;
        core.height = size;
        core.alpha = remaining ** 0.6;
        coreLeft -= delta;
      } else {
        core.alpha = 0;
      }

      if (shockLeft > 0) {
        // Cubic ease-out: the ring leaves at speed and settles, which is the whole
        // reason it reads as pressure rather than as a growing circle.
        const age = 1 - shockLeft / SHOCK_FRAMES;
        const radius = 18 + SHOCK_RADIUS * (1 - (1 - age) ** 3);
        shock.clear();
        shock.circle(at.x, at.y, radius).stroke({
          width: Math.max(1, SHOCK_WIDTH * (1 - age)),
          color: palette.SHOCKWAVE,
          alpha: (1 - age) ** 1.4 * 0.8,
        });
        shockLeft -= delta;
        if (shockLeft <= 0) shock.clear();
      }

      if (afterglowLeft > 0) {
        // Swells and subsides rather than fading from full, so it arrives as the
        // fireball leaves instead of being another thing decaying alongside it.
        const age = 1 - afterglowLeft / AFTERGLOW_FRAMES;
        const size =
          AFTERGLOW_SIZE[0] + (AFTERGLOW_SIZE[1] - AFTERGLOW_SIZE[0]) * age;
        afterglow.x = at.x;
        afterglow.y = at.y;
        afterglow.width = size;
        afterglow.height = size;
        afterglow.alpha = Math.sin(Math.PI * age) * 0.3;
        afterglowLeft -= delta;
      } else {
        afterglow.alpha = 0;
      }

      /**
       * The kick, handed back for the caller to apply to the whole scene.
       *
       * Re-rolled every frame rather than eased along a path: a smooth displacement
       * reads as the chart sliding, and jitter is what reads as an impact. Squared,
       * so it is violent for a handful of frames and then simply over - and exactly
       * zero at the end, because a scene left a third of a pixel off centre never
       * recovers.
       */
      if (shakeLeft <= 0) return { x: 0, y: 0 };

      const power = motion.shake * (shakeLeft / SHAKE_FRAMES) ** 2;
      shakeLeft -= delta;
      if (shakeLeft <= 0) return { x: 0, y: 0 };
      return {
        x: (Math.random() - 0.5) * 2 * power,
        y: (Math.random() - 0.5) * 2 * power,
      };
    },

    clear(): void {
      flashLeft = 0;
      blastLeft = 0;
      coreLeft = 0;
      shockLeft = 0;
      afterglowLeft = 0;
      shakeLeft = 0;
      shock.clear();
      flash.alpha = 0;
      afterglow.alpha = 0;
      blast.alpha = 0;
      core.alpha = 0;
    },
  };
};
