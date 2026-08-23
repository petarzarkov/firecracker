import type { Container, Texture } from 'pixi.js';
import { createMotePool, type MotePool } from '../pool.js';
import * as palette from '../palette.js';

/**
 * The trail off the curve's tip, and the burst when it stops.
 *
 * Same simulation the canvas version ran - a few motes a frame while climbing,
 * forty at once on the crash, gravity pulling them down - moved onto a batched
 * particle container. The numbers are unchanged on purpose: this is the round's
 * signature, and a port is not the place to redesign it.
 */

const CAPACITY = 460;
const GRAVITY = 0.08;
const TRAIL_MAX_PER_FRAME = 6;
const TRAIL_LIFE = 25;

/**
 * The crash burst, in two bands.
 *
 * One band of forty motes at one speed all died together, about half a second after
 * they were born, which is the "poof": a ring that opens and is gone, with nothing
 * left behind it. Real debris separates - the fast shrapnel is out of frame while
 * the heavy cinders are still arcing over - so there are two populations here, and
 * the slow one outlives the fireball on purpose.
 */
const SHRAPNEL_COUNT = 54;
const SHRAPNEL_SPEED = [3, 11] as const;
const SHRAPNEL_LIFE = [26, 44] as const;

const CINDER_COUNT = 46;
const CINDER_SPEED = [0.4, 3.4] as const;
const CINDER_LIFE = [70, 130] as const;

/** How much of its speed a cinder keeps each frame, so the arc settles. */
const CINDER_DRAG = 0.975;

/** {@link Mote.tag} for the slower band, so `advance` knows which to drag and dim. */
const CINDER = 1;

const between = ([min, max]: readonly [number, number]): number =>
  min + Math.random() * (max - min);

export interface Embers {
  readonly view: Container;
  /** A few motes off the tip. Call while the round is climbing. */
  trail(x: number, y: number, multiplier: number, delta: number): void;
  /** The one-shot burst when the round ends. */
  burst(x: number, y: number, multiplier: number): void;
  advance(crashed: boolean, delta: number): void;
  clear(): void;
}

export const createEmbers = (texture: Texture): Embers => {
  const pool: MotePool = createMotePool(CAPACITY, texture);

  return {
    view: pool.view,

    trail(x, y, multiplier, delta): void {
      // Scaled by delta too: a spawn-per-frame rate would make the trail three
      // times denser on a 180Hz display than on a 60Hz one.
      const count = Math.round(
        Math.min(Math.ceil(multiplier / 3), TRAIL_MAX_PER_FRAME) * delta,
      );
      const tint = palette.emberFor(multiplier);
      for (let i = 0; i < count; i++) {
        // Upward-biased cone, so the trail falls behind the climb rather than
        // haloing the tip.
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
        const speed = Math.random() * 2 + 0.5;
        pool.spawn({
          x: x + (Math.random() - 0.5) * 4,
          y: y + (Math.random() - 0.5) * 4,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.5,
          life: TRAIL_LIFE,
          size: Math.random() * 1.5 + 0.5,
          tint,
        });
      }
    },

    burst(x, y, multiplier): void {
      const tint = palette.emberFor(multiplier);

      for (let i = 0; i < SHRAPNEL_COUNT; i++) {
        // Evenly spaced with jitter rather than uniformly random, so the first
        // instant reads as a sphere blowing out rather than as a clump.
        const angle =
          (Math.PI * 2 * i) / SHRAPNEL_COUNT + (Math.random() - 0.5) * 0.5;
        const speed = between(SHRAPNEL_SPEED);
        pool.spawn({
          x: x + (Math.random() - 0.5) * 6,
          y: y + (Math.random() - 0.5) * 6,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: between(SHRAPNEL_LIFE),
          size: Math.random() * 1.8 + 0.8,
          tint,
        });
      }

      for (let i = 0; i < CINDER_COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = between(CINDER_SPEED);
        pool.spawn({
          x: x + (Math.random() - 0.5) * 10,
          y: y + (Math.random() - 0.5) * 10,
          vx: Math.cos(angle) * speed,
          // Biased upward, so they are thrown before they fall - which is what
          // gives the burst a second half instead of just an end.
          vy: Math.sin(angle) * speed - 1.2,
          life: between(CINDER_LIFE),
          size: Math.random() * 1.2 + 0.4,
          tint,
          tag: CINDER,
        });
      }
    },

    advance(crashed, delta): void {
      pool.update((mote, step) => {
        const cinder = mote.tag === CINDER;
        if (cinder) {
          // Air resistance, so a cinder stops travelling and starts falling -
          // without it they keep their launch speed all the way off-screen and
          // the burst looks like it never lands.
          mote.vx *= CINDER_DRAG ** step;
          mote.vy *= CINDER_DRAG ** step;
        }
        mote.x += mote.vx * step;
        mote.y += mote.vy * step;
        mote.vy += GRAVITY * step;
        const remaining = mote.life / mote.maxLife;
        // Cinders hold their brightness and then go, rather than fading from the
        // first frame: a linear fade over a long life is a mote that is barely
        // visible for most of it.
        mote.alpha = (cinder ? remaining ** 0.55 : remaining) * 0.85;
        mote.size = Math.max(0.3, remaining * mote.size);
        // Recoloured on the crash so the trail already in flight turns with the
        // curve, rather than a red line trailing orange sparks.
        if (crashed) mote.tint = palette.EMBER_CRASHED;
      }, delta);
    },

    clear(): void {
      pool.clear();
    },
  };
};
