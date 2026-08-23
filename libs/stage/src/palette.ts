/**
 * Every colour the stage draws, named for its job.
 *
 * The client's Chakra theme cannot be read from here - this is a lib with no
 * React and no Chakra - and that is the point of listing them: the canvas used to
 * carry a dozen literals scattered across seven draw modules, including a real
 * green glow under text the theme had already turned orange.
 */

/** The curve, and everything that trails from its tip. */
export const CURVE = 0xff9500;
export const CURVE_CRASHED = 0xff4444;

/** The plot furniture. Alphas are separate because PIXI takes them separately. */
export const GRID_LINE = 0xffffff;
export const GRID_LINE_ALPHA = 0.06;
export const AXIS_LINE_ALPHA = 0.15;
export const LABEL = 0xffffff;
export const LABEL_ALPHA = 0.55;

export const STAR = 0xffffff;

/** What a cash-out's label is written in: legible over a lit plot, not white. */
export const CASHOUT_TEXT = 0xffe2b0;

/**
 * A boarding player's name, dimmer than {@link CASHOUT_TEXT} on purpose: a name
 * flying up to the rocket is somebody spending money and a canopy is somebody
 * winning it, and the second is the one that should catch an eye first.
 */
export const BOARDING_TEXT = 0xe0cdb2;

export const FLASH = 0xff4444;

/**
 * The crash, in the order it is drawn: the white instant at the centre, the ring
 * leaving it, and the residue that outlives both.
 */
export const BLAST_CORE = 0xfff3d0;
export const SHOCKWAVE = 0xffd9a0;
export const AFTERGLOW = 0xc24a12;

/**
 * The fireball's colour as it ages, `0` at the detonation and `1` when it is spent.
 *
 * Three steps rather than an interpolation: the sprite is a soft halo whose own
 * falloff already blends whatever it is tinted, so a gradient between two shades of
 * the same shape reads as one colour and costs a lerp per frame to do it.
 */
export const blastTintFor = (age: number): number => {
  if (age < 0.18) return BLAST_CORE;
  if (age < 0.45) return 0xffa03c;
  return FLASH;
};

/**
 * The trail's colour, hotter as the round climbs - the same thresholds the canvas
 * version used, so a player who knows what red means still reads it the same way.
 */
export const emberFor = (multiplier: number): number => {
  if (multiplier >= 10) return 0xff2400;
  if (multiplier >= 5) return 0xff5349;
  if (multiplier >= 2) return 0xff8c00;
  return 0xffd232;
};

export const EMBER_CRASHED = 0xff4444;

/** The ambient wash behind the tip: warm, then hot, then violet at 10x. */
export interface Glow {
  readonly color: number;
  readonly alpha: number;
}

export const glowFor = (multiplier: number): Glow => {
  if (multiplier >= 10) return { color: 0xb400ff, alpha: 0.07 };
  if (multiplier >= 5) return { color: 0xff8c00, alpha: 0.06 };
  if (multiplier >= 2) return { color: 0xffc800, alpha: 0.05 };
  return { color: 0xff6b00, alpha: 0.04 };
};

export const WICK_SPARKS = [0xffc832, 0xff8c00, 0xffffb4, 0xff5a00] as const;

export const WICK_CORE = 0xfffdc8;
export const WICK_HALO = 0xffa01e;

/**
 * The fuse's flame, hotter as the round climbs - amber, then orange, then the
 * violet the tip wash already turns at 10x, so the two agree about what a big
 * round looks like.
 */
export const flameFor = (multiplier: number): number => {
  if (multiplier >= 10) return 0xd070ff;
  if (multiplier >= 5) return 0xff6a2a;
  if (multiplier >= 2) return 0xff8c1e;
  return WICK_HALO;
};

export const FIREWORKS = [
  0xff2400, // scarlet
  0xff4444, // bright red
  0xff5349, // orange-red
  0xff7800, // orange
  0xff8c00, // dark orange
  0xffa500, // light orange
  0xffd232, // golden
] as const;
