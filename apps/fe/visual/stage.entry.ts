import {
  createStage,
  type Stage,
  type StageBoarding,
  type StageCashOut,
  type StagePhase,
  type StagePoint,
} from '@firecracker/stage';

/**
 * The page the stage specs drive. Runs in the browser, bundled by `harness.ts`.
 *
 * It is the client's `CrashChart` with React, the store and the socket taken out -
 * which is possible at all because `createStage` asks for a sampler rather than
 * reading a store. The seam the lib was built around is the seam a test drives it
 * through, so nothing here is a mock of anything: it is the same call the app makes,
 * over a round this file makes up.
 */

/** Must match `MULTIPLIER_DIVISOR` in the client's store. */
const DIVISOR = 10_000;

const curveAt = (elapsedMs: number): number => Math.exp(elapsedMs / DIVISOR);

/** What the server would have recorded by now: one point every 100 ms. */
const pointsTo = (elapsed: number): StagePoint[] => {
  const points: StagePoint[] = [];
  for (let at = 0; at <= elapsed; at += 100) {
    points.push({
      elapsed: at,
      multiplier: Math.floor(curveAt(at) * 100) / 100,
    });
  }
  return points;
};

declare global {
  /** Draws exactly one frame. Installed by `installClock` before this bundle runs. */
  var __pump: () => void;
}

/** The round the harness is pretending to be in. */
export interface HarnessRound {
  phase: StagePhase;
  /** Milliseconds since the launch. Stepped by `advance` while running. */
  elapsed: number;
  waitingLeft: number | null;
}

const round: HarnessRound = { phase: 'idle', elapsed: 0, waitingLeft: null };

const boardings: StageBoarding[] = [];
const cashOuts: StageCashOut[] = [];

/**
 * The harness's own controls, reached from a spec through `page.evaluate`. Written
 * onto `globalThis` rather than exported because the spec's only way in is the
 * browser's global scope.
 */
export interface StageHarness {
  /** Resolves once the renderer and both sprites are up. */
  readonly ready: Promise<void>;
  /** Put the round in a phase. `waitingLeft` drives the pre-launch strain. */
  set(next: Partial<HarnessRound>): void;
  /** Somebody bet. Drawn on the next frame, exactly as `betPlaced` would be. */
  board(name: string, betAmountCents: number): void;
  /** Somebody got out. */
  cashOut(name: string, multiplier: number, payoutCents: number): void;
  /** Runs the round's clock forward and draws it. See `installClock`. */
  advance(frames: number): void;
  /**
   * The canvas as a coarse grid of average colours, row-major.
   *
   * A screenshot is for a person; this is what a spec can assert on. It reads the
   * live drawing buffer, which is only valid in the same task as the draw - hence
   * `advance` and this being callable in one `page.evaluate`, and hence no
   * `preserveDrawingBuffer`, which costs a full-frame copy on every frame.
   */
  grid(cols: number, rows: number): Cell[];
  /**
   * One horizontal scanline as luminance, 0-255, left to right, at `at` of the way
   * down the canvas. Where {@link grid} averages cells - which is what makes it
   * stable - this keeps every pixel, because some things are only a pixel wide: a
   * fill closing on a hard edge is one column of step and nothing either side.
   */
  row(at: number): number[];
}

/** One cell of {@link StageHarness.grid}: an average colour, 0-255. */
export interface Cell {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** The cell's brightness, 0-255, for the common "is anything drawn here" check. */
  readonly light: number;
}

const container = document.createElement('div');
container.style.cssText = 'position:absolute;inset:0';
document.body.appendChild(container);

/** The renderer's context, for the two probes that read pixels back. */
const context = (): WebGLRenderingContext | WebGL2RenderingContext => {
  const canvas = container.querySelector('canvas');
  if (canvas === null) throw new Error('the stage drew no canvas');
  const gl =
    canvas.getContext('webgl2') ??
    (canvas.getContext('webgl') as WebGLRenderingContext | null);
  if (gl === null) throw new Error('the canvas has no WebGL context');
  return gl;
};

let stage: Stage | null = null;

const ready = createStage({
  container,
  sample: () => ({
    phase: round.phase,
    multiplier: Math.floor(curveAt(round.elapsed) * 100) / 100,
    elapsed: round.elapsed,
    points: round.phase === 'running' ? pointsTo(round.elapsed) : [],
    curveAt,
    waitingLeft: round.waitingLeft,
  }),
  takeBoardings: () => boardings.splice(0, boardings.length),
  takeCashOuts: () => cashOuts.splice(0, cashOuts.length),
  rocketUrl: '/sprites/firecracker.svg',
  parachutistUrl: '/sprites/parachutist.svg',
  boarderUrl: '/sprites/boarder.svg',
}).then((created) => {
  stage = created;
});

const harness: StageHarness = {
  ready,
  set(next): void {
    Object.assign(round, next);
  },
  board(name, betAmountCents): void {
    boardings.push({ name, betAmountCents });
  },
  cashOut(name, multiplier, payoutCents): void {
    cashOuts.push({ name, multiplier, payoutCents });
  },
  advance(frames): void {
    if (stage === null) throw new Error('the stage has not started');
    // A running round's clock is the frame clock: the client interpolates the
    // multiplier off `Date.now()`, and a spec stepping frames without stepping the
    // round would draw the same instant over and over.
    for (let i = 0; i < frames; i++) {
      if (round.phase === 'running') round.elapsed += 1000 / 60;
      if (round.phase === 'waiting' && round.waitingLeft !== null) {
        round.waitingLeft -= 1000 / 60;
      }
      globalThis.__pump();
    }
  },
  row(at): number[] {
    const gl = context();
    const width = gl.drawingBufferWidth;
    // The buffer is bottom-up, so the top of the canvas is its last row.
    const y = Math.round(
      (1 - Math.max(0, Math.min(1, at))) * (gl.drawingBufferHeight - 1),
    );

    const pixels = new Uint8Array(width * 4);
    gl.readPixels(0, y, width, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const line: number[] = [];
    for (let x = 0; x < width; x++) {
      const at3 = x * 4;
      line.push(
        ((pixels[at3] as number) +
          (pixels[at3 + 1] as number) +
          (pixels[at3 + 2] as number)) /
          3,
      );
    }
    return line;
  },
  grid(cols, rows): Cell[] {
    const gl = context();

    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const cells: Cell[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // WebGL reads bottom-up, so the first row out is the bottom of the plot.
        // Flipped here, or every assertion about "the top of the chart" is upside
        // down - and it would still pass on a symmetrical frame.
        const y0 = Math.floor(((rows - 1 - row) * height) / rows);
        const y1 = Math.floor(((rows - row) * height) / rows);
        const x0 = Math.floor((col * width) / cols);
        const x1 = Math.floor(((col + 1) * width) / cols);

        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const at = (y * width + x) * 4;
            r += pixels[at] as number;
            g += pixels[at + 1] as number;
            b += pixels[at + 2] as number;
            count++;
          }
        }
        const safe = Math.max(1, count);
        const cell = { r: r / safe, g: g / safe, b: b / safe };
        cells.push({ ...cell, light: (cell.r + cell.g + cell.b) / 3 });
      }
    }
    return cells;
  },
};

(globalThis as unknown as { __harness: StageHarness }).__harness = harness;
