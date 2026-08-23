import { Container, Sprite, type Texture } from 'pixi.js';
import { createMotePool, type MotePool } from '../pool.js';
import * as palette from '../palette.js';

/**
 * The lit fuse: a halo while the round waits, sparks while it climbs. Two tinted
 * sprites of the shared halo texture, so it costs a transform rather than two
 * gradients a frame.
 */

const CAPACITY = 96;

/** The fuse at rest, waiting to launch. */
const IDLE_HALO = 44;
const IDLE_CORE = 15;

/**
 * The fuse burning down through the betting window.
 *
 * It used to be one unchanging pair of discs for the whole countdown, which says
 * "lit" and never says "about to go". Now it swells and throws sparks as the launch
 * approaches - the same signal the rocket's rumble gives, on the part of it a player
 * is already watching.
 */
const IDLE_PULSE_RATE = 0.06;
const IDLE_PULSE = 0.16;
/** How much bigger the flame gets by the end of the window. */
const TENSION_GROWTH = 1.5;
/** Sparks per frame at full tension. None at all until the fuse is really going. */
const TENSION_SPARKS = 5;

/** How far the flame grows once burning. The fuse stays lit the whole way up. */
const FLAME_HALO = [72, 240] as const;
const FLAME_CORE = [26, 92] as const;

/**
 * The jet: a stretched halo anchored at the fuse, pointing back down the body. Two
 * concentric discs read as a lit fuse but never as thrust however large they get -
 * a flame has a direction.
 */
const PLUME_LENGTH = [26, 210] as const;
const PLUME_WIDTH = [16, 62] as const;

/**
 * Heat saturates at 10x. Past that a round is already spectacular and a flame
 * that kept growing would swallow the curve it is supposed to be riding.
 */
const HEAT_CEILING = Math.log(10);

/** Sparks per frame at no heat and at full heat. */
const SPARKS = [2, 9] as const;

const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * t;

/** Sparks float up and slow down; they are embers, not debris. */
const LIFT = 0.06;
const DRAG = 0.93;

export interface Wick {
  readonly view: Container;
  /**
   * The halo, for a fuse that is lit but not yet flying. `tension` is the launch
   * approaching - see `tensionAt` in the rocket layer.
   */
  glow(x: number, y: number, tension: number, delta: number): void;
  /**
   * The fuse burning in flight: a flame that grows and whitens with the round,
   * and throws sparks at a rate to match.
   *
   * `multiplier` rather than a 0-1 knob, so the mapping from "how well is this
   * round going" to "how hard is it burning" lives in one place.
   */
  flame(
    x: number,
    y: number,
    multiplier: number,
    angle: number,
    delta: number,
  ): void;
  advance(delta: number): void;
  /** Hides the halo without clearing sparks already in the air. */
  dim(): void;
  clear(): void;
}

/** 0 at 1x, 1 from 10x up. */
export const heatOf = (multiplier: number): number =>
  Math.max(0, Math.min(1, Math.log(Math.max(1, multiplier)) / HEAT_CEILING));

export const createWick = (texture: Texture, halo: Texture): Wick => {
  const view = new Container();

  const outer = new Sprite(halo);
  outer.anchor.set(0.5);
  outer.tint = palette.WICK_HALO;
  outer.alpha = 0;

  const core = new Sprite(halo);
  core.anchor.set(0.5);
  core.tint = palette.WICK_CORE;
  core.alpha = 0;

  // Anchored at its top edge, so it hangs from the fuse rather than straddling
  // it, and rotating it swings the jet rather than spinning it in place.
  const plume = new Sprite(halo);
  plume.anchor.set(0.5, 0);
  plume.alpha = 0;

  const place = (x: number, y: number, haloSize: number, coreSize: number) => {
    outer.x = x;
    outer.y = y;
    outer.width = haloSize;
    outer.height = haloSize;
    core.x = x;
    core.y = y;
    core.width = coreSize;
    core.height = coreSize;
  };

  const pool: MotePool = createMotePool(CAPACITY, texture);

  /** The idle pulse's phase, so the fuse breathes rather than sitting still. */
  let idleAt = 0;

  view.addChild(plume, outer, core, pool.view);

  return {
    view,

    glow(x, y, tension, delta): void {
      idleAt += IDLE_PULSE_RATE * delta;
      // A pulse rather than a flicker: the flicker in `flame` sells a jet being
      // driven, and this is a fuse burning at its own pace.
      const pulse = 1 + Math.sin(idleAt) * IDLE_PULSE;
      const grow = pulse * (1 + TENSION_GROWTH * tension);

      plume.alpha = 0;
      place(x, y, IDLE_HALO * grow, IDLE_CORE * grow);
      outer.tint = palette.WICK_HALO;
      outer.alpha = 0.55 + 0.35 * tension;
      core.tint = palette.WICK_CORE;
      core.alpha = 0.95;

      // Squared, so the fuse spits only in the last seconds instead of drizzling
      // sparks through the whole window.
      const count = Math.round(TENSION_SPARKS * tension ** 2 * delta);
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        const speed = Math.random() * 1.4 + 0.5;
        pool.spawn({
          x: x + (Math.random() - 0.5) * 6,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: Math.floor(Math.random() * 12) + 8,
          size: Math.random() * 1.1 + 0.4,
          tint:
            palette.WICK_SPARKS[
              Math.floor(Math.random() * palette.WICK_SPARKS.length)
            ] ?? palette.WICK_HALO,
        });
      }
    },

    flame(x, y, multiplier, angle, delta): void {
      const heat = heatOf(multiplier);

      plume.x = x;
      plume.y = y;
      plume.rotation = angle;
      plume.width = lerp(PLUME_WIDTH[0], PLUME_WIDTH[1], heat);
      plume.height = lerp(PLUME_LENGTH[0], PLUME_LENGTH[1], heat);
      plume.tint = palette.flameFor(multiplier);

      place(
        x,
        y,
        lerp(FLAME_HALO[0], FLAME_HALO[1], heat),
        lerp(FLAME_CORE[0], FLAME_CORE[1], heat),
      );

      // Flicker, so a flame that is otherwise a pair of static discs reads as
      // burning. Cheaper and steadier than spawning more sparks for the effect.
      const flicker = 0.9 + Math.random() * 0.2;
      plume.alpha = lerp(0.35, 0.8, heat) * flicker;
      outer.tint = palette.flameFor(multiplier);
      outer.alpha = lerp(0.6, 0.95, heat) * flicker;
      core.tint = palette.WICK_CORE;
      core.alpha = lerp(0.9, 1, heat) * flicker;

      const count = Math.round(lerp(SPARKS[0], SPARKS[1], heat) * delta);
      for (let i = 0; i < count; i++) {
        // Wider and faster as it burns, so the plume opens out rather than
        // simply thickening.
        const spread = lerp(1.2, 2.1, heat);
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
        const speed = (Math.random() * 1.7 + 0.8) * lerp(1, 2.2, heat);
        pool.spawn({
          x: x + (Math.random() - 0.5) * lerp(5, 12, heat),
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: Math.floor(Math.random() * 15) + 10,
          size: (Math.random() * 1.2 + 0.4) * lerp(1, 1.8, heat),
          tint:
            palette.WICK_SPARKS[
              Math.floor(Math.random() * palette.WICK_SPARKS.length)
            ] ?? palette.WICK_HALO,
        });
      }
    },

    dim(): void {
      plume.alpha = 0;
      outer.alpha = 0;
      core.alpha = 0;
    },

    advance(delta): void {
      pool.update((mote, step) => {
        mote.x += mote.vx * step;
        mote.y += mote.vy * step;
        mote.vy -= LIFT * step;
        mote.vx *= DRAG ** step;
        const remaining = mote.life / mote.maxLife;
        mote.alpha = remaining * 0.9;
        mote.size = Math.max(0.3, remaining * mote.size);
      }, delta);
    },

    clear(): void {
      pool.clear();
      plume.alpha = 0;
      outer.alpha = 0;
      core.alpha = 0;
    },
  };
};
