import { Particle, ParticleContainer, type Texture } from 'pixi.js';

/**
 * A fixed pool of motes: the starfield, the trail, the wick sparks and the
 * fireworks.
 *
 * **Fixed, and never resized.** Particles are allocated once and recycled - a spawn
 * claims a dead slot, a death sets `alpha = 0` - because {@link ParticleContainer}
 * uploads its children as one batched buffer, so a stable child list is the fast
 * path.
 *
 * A spawn with every slot alive overwrites the oldest, which is the one about to die
 * anyway: dropping it would thin a burst out exactly when it should be densest.
 */

export interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Frames left. `0` means the slot is free. */
  life: number;
  /** What `life` started at, so a step can fade against it. */
  maxLife: number;
  /** Radius in pixels at full life. */
  size: number;
  tint: number;
  alpha: number;
}

export interface MoteSeed {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  tint: number;
}

/**
 * Advances one mote; `false` kills it early. `delta` is PIXI's frame delta, `1` at
 * 60fps - every velocity in this scene is per-60fps-frame and multiplied by it, so a
 * 144Hz display does not run the particles at two and a half times speed.
 */
export type MoteStep = (mote: Mote, delta: number) => boolean | void;

export interface MotePool {
  readonly view: ParticleContainer;
  spawn(seed: MoteSeed): void;
  /** Steps every live mote and syncs the result onto its particle. */
  update(step: MoteStep, delta: number): void;
  /** Kills everything, e.g. when a round ends. */
  clear(): void;
  readonly alive: number;
}

/** The texture is drawn at this size, so scale 1 is a mote of this radius. */
const TEXTURE_RADIUS = 32;

export const createMotePool = (
  capacity: number,
  texture: Texture,
): MotePool => {
  const view = new ParticleContainer({
    /**
     * `vertex` carries scale and anchor, which the name does not say and these motes
     * need - they shrink as they die. A `scale` key instead, which is not one of the
     * five PIXI recognises, builds a geometry the particle shader has never heard of
     * and silently renders nothing, taking the grid and the curve down with it.
     */
    dynamicProperties: {
      vertex: true,
      position: true,
      color: true,
      rotation: false,
      uvs: false,
    },
  });

  const motes: Mote[] = [];
  const particles: Particle[] = [];

  for (let i = 0; i < capacity; i++) {
    const particle = new Particle({
      texture,
      anchorX: 0.5,
      anchorY: 0.5,
      alpha: 0,
    });
    particles.push(particle);
    view.addParticle(particle);
    motes.push({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 1,
      tint: 0xffffff,
      alpha: 0,
    });
  }

  let cursor = 0;
  let alive = 0;

  /** The next free slot, or the oldest live one when the pool is full. */
  const claim = (): number => {
    for (let i = 0; i < capacity; i++) {
      const index = (cursor + i) % capacity;
      if ((motes[index] as Mote).life <= 0) {
        cursor = (index + 1) % capacity;
        alive += 1;
        return index;
      }
    }
    const index = cursor;
    cursor = (cursor + 1) % capacity;
    return index;
  };

  return {
    view,

    get alive() {
      return alive;
    },

    spawn(seed: MoteSeed): void {
      if (capacity === 0) return;
      const mote = motes[claim()] as Mote;
      mote.x = seed.x;
      mote.y = seed.y;
      mote.vx = seed.vx;
      mote.vy = seed.vy;
      mote.life = seed.life;
      mote.maxLife = Math.max(1, seed.life);
      mote.size = seed.size;
      mote.tint = seed.tint;
      mote.alpha = 1;
    },

    update(step: MoteStep, delta: number): void {
      for (let i = 0; i < capacity; i++) {
        const mote = motes[i] as Mote;
        const particle = particles[i] as Particle;
        if (mote.life <= 0) {
          particle.alpha = 0;
          continue;
        }

        mote.life -= delta;
        const living = step(mote, delta) !== false && mote.life > 0;
        if (!living) {
          mote.life = 0;
          particle.alpha = 0;
          alive -= 1;
          continue;
        }

        particle.x = mote.x;
        particle.y = mote.y;
        particle.alpha = mote.alpha;
        particle.tint = mote.tint;
        const scale = mote.size / TEXTURE_RADIUS;
        particle.scaleX = scale;
        particle.scaleY = scale;
      }
      view.update();
    },

    clear(): void {
      for (let i = 0; i < capacity; i++) {
        (motes[i] as Mote).life = 0;
        (particles[i] as Particle).alpha = 0;
      }
      alive = 0;
      view.update();
    },
  };
};
