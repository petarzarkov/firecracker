/**
 * The page's clock and its randomness, both made to stand still.
 *
 * Injected before any other script on the page - see `openStage` - because PIXI
 * captures `requestAnimationFrame` when its ticker starts, and an override applied
 * afterwards is an override of nothing.
 *
 * Two things make a rendered frame reproducible, and the rig needs both:
 *
 *  - **The frame clock.** Left alone, the stage draws as fast as SwiftShader can,
 *    so "wait 500ms and screenshot" catches a different frame on every run and on
 *    every machine. Here a frame happens only when a spec asks for one, and each is
 *    exactly 1/60s, so `advance(90)` is the same ninety frames every time.
 *  - **`Math.random`.** The starfield, the rumble, every spark and every boarder's
 *    launch point come out of it. Seeded, a run is repeatable; unseeded, no two
 *    screenshots of the same moment match.
 *
 * Together they are what makes a screenshot worth comparing to the last one.
 */
export const installClock = (seed: number): void => {
  let state = seed >>> 0;
  // mulberry32: four lines, and good enough for scattering sparks. This is a rig,
  // not the game - the crash point's RNG has an entirely different job.
  Math.random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };

  const FRAME_MS = 1000 / 60;
  let clock = 0;
  let pending: FrameRequestCallback | null = null;

  globalThis.requestAnimationFrame = (
    callback: FrameRequestCallback,
  ): number => {
    pending = callback;
    return 1;
  };
  globalThis.cancelAnimationFrame = (): void => {
    pending = null;
  };
  // PIXI's ticker measures its delta with this, so a stepped `rAF` and a real
  // `performance.now` would hand it whatever the wall clock did in between.
  performance.now = (): number => clock;

  (globalThis as unknown as { __pump: () => void }).__pump = (): void => {
    clock += FRAME_MS;
    const callback = pending;
    pending = null;
    callback?.(clock);
  };
};
