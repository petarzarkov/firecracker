import { Particle, ParticleContainer, type Texture } from 'pixi.js';
import * as palette from '../palette.js';
import type { StagePhase } from '../types.js';

/**
 * The starfield the rocket flies through: points projected from a 3D field that
 * streams toward the viewer, faster while a round runs.
 *
 * Not a {@link import('../pool.js').MotePool} - these never die, they recycle to
 * the far plane, so the pool's life bookkeeping would be dead weight.
 */

const STAR_COUNT = 150;
const FIELD = 2000;
const DEPTH = 1000;

const SPEED: Readonly<Record<StagePhase, number>> = {
  running: 9,
  waiting: 1.5,
  crashed: 0.3,
  idle: 0.5,
};

/** The texture is a 64px disc, so this is the scale for a one-pixel star. */
const TEXTURE_RADIUS = 32;

interface Star {
  x: number;
  y: number;
  z: number;
}

export interface Starfield {
  readonly view: ParticleContainer;
  update(phase: StagePhase, width: number, height: number, delta: number): void;
}

const reseed = (star: Star, z: number): void => {
  star.x = (Math.random() - 0.5) * FIELD;
  star.y = (Math.random() - 0.5) * FIELD;
  star.z = z;
};

export const createStarfield = (texture: Texture): Starfield => {
  const view = new ParticleContainer({
    // `vertex` carries scale — see the note in `pool.ts`. Stars pulse in size
    // with their depth, so it has to be dynamic here too.
    dynamicProperties: {
      vertex: true,
      position: true,
      color: true,
      rotation: false,
      uvs: false,
    },
  });

  const stars: Star[] = [];
  const particles: Particle[] = [];

  for (let i = 0; i < STAR_COUNT; i++) {
    const star: Star = { x: 0, y: 0, z: 0 };
    // Seeded across the whole depth rather than at the far plane, so the field
    // opens already full instead of fading in over the first few seconds.
    reseed(star, Math.random() * DEPTH);
    stars.push(star);

    const particle = new Particle({
      texture,
      anchorX: 0.5,
      anchorY: 0.5,
      tint: palette.STAR,
      alpha: 0,
    });
    particles.push(particle);
    view.addParticle(particle);
  }

  return {
    view,

    update(phase, width, height, delta): void {
      const speed = SPEED[phase] * delta;
      const halfW = width / 2;
      const halfH = height / 2;

      for (let i = 0; i < STAR_COUNT; i++) {
        const star = stars[i] as Star;
        const particle = particles[i] as Particle;

        star.z -= speed;
        if (star.z <= 1) reseed(star, DEPTH);

        const x = (star.x / star.z) * halfW + halfW;
        const y = (star.y / star.z) * halfH + halfH;

        // Off-plot stars are hidden rather than skipped: a particle left at its
        // last position with its last alpha would smear across the edge.
        if (x < 0 || x > width || y < 0 || y > height) {
          particle.alpha = 0;
          continue;
        }

        const nearness = 1 - star.z / DEPTH;
        particle.x = x;
        particle.y = y;
        particle.alpha = nearness * 0.85;
        const scale = Math.max(0.3, nearness * 2.5) / TEXTURE_RADIUS;
        particle.scaleX = scale;
        particle.scaleY = scale;
      }

      view.update();
    },
  };
};
