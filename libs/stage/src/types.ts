/**
 * What the stage needs to know, and nothing else - deliberately not the client's
 * `GamePhase`. This package has no store, no React and no contracts dependency: it
 * is handed a function answering "what is true right now", which keeps the render
 * loop off the React tree and lets a test drive it with a plain object.
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
   * Milliseconds since the round started, interpolated the same way. Both are
   * smooth where {@link points} is not - the recorded points are 100 ms apart, and
   * drawing the leading edge from the newest one snapped the whole line sideways
   * every tick, since the horizontal axis scales to the round's length.
   */
  readonly elapsed: number;
  /** The round so far, oldest first. Empty outside a round. */
  readonly points: readonly StagePoint[];
  /**
   * The curve as a continuous function of elapsed time, because {@link points} are
   * **rounded** to the hundredths the server pays in - roughly eight vertical
   * pixels, so a line through them climbs in stairs no interpolation can smooth.
   * Given it, the stage plots at screen resolution; omit it and it joins the
   * samples.
   */
  readonly curveAt?: ((elapsedMs: number) => number) | undefined;
  /**
   * Milliseconds left of the betting window, `null` outside one. The rocket is
   * parked for the whole of that window and the wait is the longest thing a player
   * looks at, so this is what turns a static sprite into a launch it can strain
   * toward - see `tensionAt`.
   */
  readonly waitingLeft?: number | null | undefined;
}

/** Called once per frame. Must be cheap - it is on the render path. */
export type StageSampler = () => StageSample;

/** Somebody bought a seat. The counterpart to {@link StageCashOut}. */
export interface StageBoarding {
  readonly name: string;
  readonly betAmountCents: number;
}

/** Somebody got out. */
export interface StageCashOut {
  readonly name: string;
  readonly multiplier: number;
  readonly payoutCents: number;
}

export interface StageOptions {
  /**
   * The element to draw into; the stage makes its **own** canvas inside it and
   * removes it on {@link Stage.destroy}. Deliberately not a caller-owned canvas: a
   * canvas has one WebGL context, so StrictMode's mount/cleanup/mount pointed two
   * `Application`s at one element and the first teardown tore the context out from
   * under the second. Must be positioned.
   */
  readonly container: HTMLElement;
  readonly sample: StageSampler;
  /** The rocket sprite. Absent means the stage draws the round without one. */
  readonly rocketUrl?: string;
  /** The parachutist sprite, for players who cash out. */
  readonly parachutistUrl?: string;
  /** The boarding sprite, for players who bet during the betting window. */
  readonly boarderUrl?: string;
  /**
   * Cash-outs since the last frame, **consumed** by the call. An event, not a
   * state, so it cannot ride {@link StageSampler} - which is read every frame and
   * would replay the same jump sixty times a second.
   */
  readonly takeCashOuts?: (() => readonly StageCashOut[]) | undefined;
  /**
   * Bets placed since the last frame, **consumed** by the call. An event for the
   * same reason {@link takeCashOuts} is: a bet is a moment, and the roster it joins
   * is already a state the caller renders in the DOM.
   */
  readonly takeBoardings?: (() => readonly StageBoarding[]) | undefined;
}

export interface Stage {
  destroy(): void;
}
