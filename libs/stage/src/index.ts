/**
 * The crash round, rendered.
 *
 * A PIXI scene with no React, no Chakra and no store - it is handed a canvas and
 * a function that answers "what is true right now", and it draws that until it is
 * destroyed. Everything the client shows *around* the round - the multiplier
 * readout, the countdown, the bet panel - stays in the DOM, where it is
 * selectable, accessible and styled by the theme.
 *
 * ```ts
 * const stage = await createStage({ canvas, sample: () => ({ … }) });
 * stage.resize();
 * stage.destroy();
 * ```
 */
export { createStage } from './stage.js';
export { ceilingFor, createScale, gridFor } from './scale.js';
export type { Insets, Plot, Scale } from './scale.js';
export type {
  Stage,
  StageCashOut,
  StageOptions,
  StagePhase,
  StagePoint,
  StageSample,
  StageSampler,
} from './types.js';
