import { Container, Sprite, type Texture } from 'pixi.js';
import { createMotePool, type MotePool } from '../pool.js';
import * as palette from '../palette.js';

/**
 * The lit fuse: a halo while the round waits, sparks while it climbs.
 *
 * The halo was two `createRadialGradient` calls per frame on the canvas. Here it
 * is two tinted sprites of the shared halo texture, so it costs a transform.
 */

const CAPACITY = 96;

const HALO_SIZE = 44;
const CORE_SIZE = 15;

/** Sparks float up and slow down; they are embers, not debris. */
const LIFT = 0.06;
const DRAG = 0.93;

export interface Wick {
  readonly view: Container;
  /** The halo, for a fuse that is lit but not yet flying. */
  glow(x: number, y: number): void;
  /** Sparks off the fuse. Call each frame while the round runs. */
  spark(x: number, y: number): void;
  advance(): void;
  /** Hides the halo without clearing sparks already in the air. */
  dim(): void;
  clear(): void;
}

export const createWick = (texture: Texture, halo: Texture): Wick => {
  const view = new Container();

  const outer = new Sprite(halo);
  outer.anchor.set(0.5);
  outer.width = HALO_SIZE;
  outer.height = HALO_SIZE;
  outer.tint = palette.WICK_HALO;
  outer.alpha = 0;

  const core = new Sprite(halo);
  core.anchor.set(0.5);
  core.width = CORE_SIZE;
  core.height = CORE_SIZE;
  core.tint = palette.WICK_CORE;
  core.alpha = 0;

  const pool: MotePool = createMotePool(CAPACITY, texture);

  view.addChild(outer, core, pool.view);

  return {
    view,

    glow(x, y): void {
      outer.x = x;
      outer.y = y;
      outer.alpha = 0.55;
      core.x = x;
      core.y = y;
      core.alpha = 0.95;
    },

    dim(): void {
      outer.alpha = 0;
      core.alpha = 0;
    },

    spark(x, y): void {
      const count = Math.floor(Math.random() * 3) + 2;
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
        const speed = Math.random() * 1.7 + 0.8;
        pool.spawn({
          x: x + (Math.random() - 0.5) * 5,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: Math.floor(Math.random() * 15) + 10,
          size: Math.random() * 1.2 + 0.4,
          tint:
            palette.WICK_SPARKS[
              Math.floor(Math.random() * palette.WICK_SPARKS.length)
            ] ?? palette.WICK_HALO,
        });
      }
    },

    advance(): void {
      pool.update((mote) => {
        mote.x += mote.vx;
        mote.y += mote.vy;
        mote.vy -= LIFT;
        mote.vx *= DRAG;
        const remaining = mote.life / mote.maxLife;
        mote.alpha = remaining * 0.9;
        mote.size = Math.max(0.3, remaining * mote.size);
      });
    },

    clear(): void {
      pool.clear();
      outer.alpha = 0;
      core.alpha = 0;
    },
  };
};
