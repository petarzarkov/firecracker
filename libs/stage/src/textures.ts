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

/**
 * The wash under the curve. Small because every profile in it is a smooth ramp:
 * stretched across a 800px plot each texel is a few pixels wide, and bilinear
 * filtering is doing the drawing.
 */
const UNDER_SIZE = 128;

/**
 * How much of the leading edge is feathered, as a fraction of the plot's width.
 *
 * The fill closes with a vertical drop from the tip to the axis, and its gradient
 * only ran *downward* - so that closing edge was a hard step from lit plot to unlit,
 * a fifty-pixel-tall seam a hundredth of a second's travel from the rocket. Measured
 * at 34 against 24 of luminance with no falloff at all, which is what reads as a
 * rectangle drawn over the chart rather than as light under a curve.
 */
const UNDER_FEATHER = 0.14;

let softDot: Texture | null = null;
let halo: Texture | null = null;
let underCurve: Texture | null = null;

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

const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * t;

/** Smooth at both ends, so the feather has no edge of its own to show. */
const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * The light under the curve: strongest along the line, gone by the axis - and gone
 * at the leading edge as well, which is the whole reason this is a painted texture
 * rather than the two-stop `FillGradient` it replaced. A linear gradient has one
 * direction, and this shape needs to fade in two.
 *
 * White, and tinted by the caller: a rising round and a crashed one differ only in
 * colour, and one texture serves both.
 */
export const underCurveTexture = (): Texture => {
  if (underCurve !== null) return underCurve;

  const canvas = document.createElement('canvas');
  canvas.width = UNDER_SIZE;
  canvas.height = UNDER_SIZE;

  const ctx = canvas.getContext('2d');
  if (ctx === null) return Texture.EMPTY;

  const image = ctx.createImageData(UNDER_SIZE, UNDER_SIZE);
  const last = UNDER_SIZE - 1;
  const featherFrom = 1 - UNDER_FEATHER;

  for (let y = 0; y < UNDER_SIZE; y++) {
    // The vertical profile the fill has always had: a flat fill buries the
    // starfield and flattens the round into a wedge by 3x.
    const v = y / last;
    const down =
      v < 0.55 ? lerp(0.34, 0.1, v / 0.55) : lerp(0.1, 0, (v - 0.55) / 0.45);

    for (let x = 0; x < UNDER_SIZE; x++) {
      const u = x / last;
      const edge =
        u < featherFrom ? 1 : 1 - smooth((u - featherFrom) / UNDER_FEATHER);

      const at = (y * UNDER_SIZE + x) * 4;
      image.data[at] = 255;
      image.data[at + 1] = 255;
      image.data[at + 2] = 255;
      image.data[at + 3] = Math.round(255 * down * edge);
    }
  }

  ctx.putImageData(image, 0, 0);
  underCurve = Texture.from(canvas);
  return underCurve;
};

/**
 * Drops all three, so a stage torn down in a test or a hot reload does not hand the
 * next one textures belonging to a destroyed renderer.
 */
export const releaseTextures = (): void => {
  softDot?.destroy(true);
  halo?.destroy(true);
  underCurve?.destroy(true);
  softDot = null;
  halo = null;
  underCurve = null;
};
