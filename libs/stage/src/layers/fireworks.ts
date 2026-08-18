import type { Container, Texture } from 'pixi.js';
import { createMotePool, type MotePool } from '../pool.js';
import * as palette from '../palette.js';

/**
 * The celebration over a finished round: six shells that climb, stagger, and
 * burst.
 *
 * The shells are plain objects rather than motes - they are not fire-and-forget,
 * they have a target and a moment where they turn into forty other things. Their
 * trails and their debris are motes, which is why both share one pool.
 */

const SHELL_COUNT = 6;
const CAPACITY = 640;

/** Frames between one shell launching and the next. */
const STAGGER = 5;

const GRAVITY = 0.12;
const DRAG = 0.97;

const TRAIL_LIFE = 9;
const BURST_MIN = 45;
const BURST_SPREAD = 20;

interface Shell {
  x: number;
  y: number;
  targetY: number;
  speed: number;
  delay: number;
  live: boolean;
  tint: number;
}

export interface Fireworks {
  readonly view: Container;
  /** Launch a volley across the given area. */
  launch(width: number, height: number, left: number, right: number): void;
  advance(delta: number): void;
  clear(): void;
  readonly busy: boolean;
}

export const createFireworks = (texture: Texture): Fireworks => {
  const pool: MotePool = createMotePool(CAPACITY, texture);
  const shells: Shell[] = [];

  const burst = (shell: Shell): void => {
    const count = BURST_MIN + Math.floor(Math.random() * BURST_SPREAD);
    for (let i = 0; i < count; i++) {
      // Evenly spaced with a little jitter, so it reads as a sphere rather than
      // a random scatter.
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
      const speed = 2 + Math.random() * 4;
      pool.spawn({
        x: shell.x,
        y: shell.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: BURST_MIN + Math.floor(Math.random() * BURST_SPREAD),
        size: Math.random() * 1.5 + 0.8,
        tint: shell.tint,
      });
    }
  };

  return {
    view: pool.view,

    get busy() {
      return shells.length > 0 || pool.alive > 0;
    },

    launch(_width, height, left, right): void {
      shells.length = 0;
      for (let i = 0; i < SHELL_COUNT; i++) {
        shells.push({
          x: left + Math.random() * Math.max(1, right - left),
          y: height,
          targetY: height * 0.15 + Math.random() * height * 0.35,
          speed: 8 + Math.random() * 6,
          delay: i * STAGGER,
          live: true,
          tint:
            palette.FIREWORKS[
              Math.floor(Math.random() * palette.FIREWORKS.length)
            ] ?? palette.FIREWORKS[0],
        });
      }
    },

    advance(delta): void {
      for (const shell of shells) {
        if (!shell.live) continue;
        if (shell.delay > 0) {
          shell.delay -= delta;
          continue;
        }

        // The trail is spawned before the move, so the shell's own head is never
        // drawn on top of the mote marking where it just was.
        pool.spawn({
          x: shell.x,
          y: shell.y,
          vx: 0,
          vy: 0,
          life: TRAIL_LIFE,
          size: 2.2,
          tint: shell.tint,
        });

        shell.y -= shell.speed * delta;
        if (shell.y <= shell.targetY) {
          shell.live = false;
          burst(shell);
        }
      }

      if (shells.length > 0 && shells.every((shell) => !shell.live)) {
        shells.length = 0;
      }

      pool.update((mote, step) => {
        mote.x += mote.vx * step;
        mote.y += mote.vy * step;
        mote.vy += GRAVITY * step;
        mote.vx *= DRAG ** step;
        const remaining = mote.life / mote.maxLife;
        mote.alpha = remaining * 0.88;
        mote.size = Math.max(0.3, remaining * mote.size);
      }, delta);
    },

    clear(): void {
      shells.length = 0;
      pool.clear();
    },
  };
};
