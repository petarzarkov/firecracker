/**
 * What the stage needs to know, and nothing else.
 *
 * Deliberately not the client's `GamePhase` or its `liveRef`: this package has no
 * store, no React and no `@firecracker/contracts` dependency. It is handed a
 * function that answers "what is true right now", and the caller decides where
 * that answer comes from - which is what keeps the render loop off the React tree
 * and makes the stage drivable from a test with a plain object.
 */

export type StagePhase = 'idle' | 'waiting' | 'running' | 'crashed';

export interface StagePoint {
  readonly elapsed: number;
  readonly multiplier: number;
}

export interface StageSample {
  readonly phase: StagePhase;
  /** The live multiplier, interpolated by the caller against its own clock. */
  readonly multiplier: number;
  /**
   * Milliseconds since the round started, interpolated the same way.
   *
   * Both of these are smooth while {@link points} is not: the server ticks ten
   * times a second, so the recorded points are 100ms apart. Drawing the leading
   * edge from the newest *point* made the curve, the rocket and the trail jump
   * six frames at a time, and - because the horizontal axis is scaled to the
   * round's length - it snapped the entire line sideways on every tick. The
   * stage draws the recorded points and then continues to here.
   */
  readonly elapsed: number;
  /** The round so far, oldest first. Empty outside a round. */
  readonly points: readonly StagePoint[];
  /**
   * The multiplier curve as a continuous function of elapsed time.
   *
   * Supplied because {@link points} are **rounded**: the server pays in integer
   * hundredths, so the samples it records step by 0.01 - about eight vertical
   * pixels early in a round. A line drawn through them climbs in visible stairs
   * no amount of interpolation between ticks can smooth, because the stepping is
   * in the values rather than in their timing.
   *
   * Given this, the stage plots the curve at screen resolution and uses the
   * recorded points only for where the round has reached. Omit it and the stage
   * falls back to joining the samples.
   */
  readonly curveAt?: ((elapsedMs: number) => number) | undefined;
}

/** Called once per frame. Must be cheap - it is on the render path. */
export type StageSampler = () => StageSample;

/** Somebody got out. */
export interface StageCashOut {
  readonly name: string;
  readonly multiplier: number;
  readonly payoutCents: number;
}

export interface StageOptions {
  /**
   * The element to draw into. The stage creates its **own** canvas inside it and
   * removes it again on {@link Stage.destroy}.
   *
   * Deliberately not a canvas the caller owns. Handing PIXI a React-owned
   * `<canvas>` meant that StrictMode's mount/cleanup/mount - and any remount -
   * pointed two `Application`s at one element, and a canvas has exactly one
   * WebGL context: the first app's teardown tore the context out from under the
   * second, and every shader after that failed to compile with "context may be
   * lost". Owning the element makes the overlap harmless, because there is no
   * shared thing to lose.
   *
   * It must be positioned (the canvas is absolutely filled into it).
   */
  readonly container: HTMLElement;
  readonly sample: StageSampler;
  /** The rocket sprite. Absent means the stage draws the round without one. */
  readonly rocketUrl?: string;
  /** The parachutist sprite, for players who cash out. */
  readonly parachutistUrl?: string;
  /**
   * Cash-outs since the last frame, **consumed** by the call.
   *
   * A cash-out is an event, not a state, so it cannot come through
   * {@link StageSampler} - a sampler is read every frame and would replay the
   * same jump sixty times a second. `take` is named for what it does: the caller
   * hands over the queue and empties it.
   */
  readonly takeCashOuts?: (() => readonly StageCashOut[]) | undefined;
}

export interface Stage {
  destroy(): void;
}
