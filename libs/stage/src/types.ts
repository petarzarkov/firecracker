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
  /** The round so far, oldest first. Empty outside a round. */
  readonly points: readonly StagePoint[];
}

/** Called once per frame. Must be cheap - it is on the render path. */
export type StageSampler = () => StageSample;

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
}

export interface Stage {
  destroy(): void;
}
