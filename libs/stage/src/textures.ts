import { Texture } from 'pixi.js';

/**
 * The two shapes everything soft in this scene is made of, drawn once into an
 * offscreen canvas and uploaded as textures.
 *
 * The canvas version reached for `createRadialGradient` five times a frame and a
 * `shadowBlur` stroke over the whole curve - both of which are per-frame CPU work
 * for something that never changes. Here the gradient is rasterised once and then
 * it is just a quad the GPU tints, which is what makes thousands of embers cost
 * about what a hundred used to.
 *
 * White on purpose: a white sprite tints to any colour, so one texture serves the
 * starfield, the trail, the wick sparks and the fireworks.
 */

const SOFT_SIZE = 64;
const HALO_SIZE = 256;

let softDot: Texture | null = null;
let halo: Texture | null = null;

const paint = (
  size: number,
  stops: readonly (readonly [number, string])[],
): Texture => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  // A context is only null when the canvas is already lost, which at this point
  // means the whole renderer is going down anyway - an empty texture draws
  // nothing rather than throwing inside the ticker.
  if (ctx === null) return Texture.EMPTY;

  const middle = size / 2;
  const gradient = ctx.createRadialGradient(
    middle,
    middle,
    0,
    middle,
    middle,
    middle,
  );
  for (const [offset, colour] of stops) gradient.addColorStop(offset, colour);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return Texture.from(canvas);
};

/** A small dot with a soft edge: stars, embers, sparks, firework debris. */
export const softDotTexture = (): Texture => {
  softDot ??= paint(SOFT_SIZE, [
    [0, 'rgba(255,255,255,1)'],
    [0.35, 'rgba(255,255,255,0.85)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  return softDot;
};

/** A wide, very soft disc: the tip wash and the wick's halo. */
export const haloTexture = (): Texture => {
  halo ??= paint(HALO_SIZE, [
    [0, 'rgba(255,255,255,1)'],
    [0.18, 'rgba(255,255,255,0.55)'],
    [0.55, 'rgba(255,255,255,0.14)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  return halo;
};

/**
 * Drops both, so a stage torn down in a test or a hot reload does not hand the
 * next one textures belonging to a destroyed renderer.
 */
export const releaseTextures = (): void => {
  softDot?.destroy(true);
  halo?.destroy(true);
  softDot = null;
  halo = null;
};
