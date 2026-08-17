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

export const FLASH = 0xff4444;

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

export const FIREWORKS = [
  0xff2400, // scarlet
  0xff4444, // bright red
  0xff5349, // orange-red
  0xff7800, // orange
  0xff8c00, // dark orange
  0xffa500, // light orange
  0xffd232, // golden
] as const;
