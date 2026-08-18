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

const CAPACITY = 320;
const GRAVITY = 0.08;
const TRAIL_MAX_PER_FRAME = 6;
const TRAIL_LIFE = 25;
const BURST_COUNT = 40;

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
      for (let i = 0; i < BURST_COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 4 + 1;
        pool.spawn({
          x: x + (Math.random() - 0.5) * 4,
          y: y + (Math.random() - 0.5) * 4,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: Math.random() * 30 + 20,
          size: Math.random() * 1.5 + 0.5,
          tint,
        });
      }
    },

    advance(crashed, delta): void {
      pool.update((mote, step) => {
        mote.x += mote.vx * step;
        mote.y += mote.vy * step;
        mote.vy += GRAVITY * step;
        const remaining = mote.life / mote.maxLife;
        mote.alpha = remaining * 0.85;
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
