import { Application, Container, Sprite } from 'pixi.js';
import { createCurve } from './layers/curve.js';
import { createEmbers } from './layers/embers.js';
import { createFireworks } from './layers/fireworks.js';
import { createGrid } from './layers/grid.js';
import { createRocket } from './layers/rocket.js';
import { createStarfield } from './layers/starfield.js';
import { createWick } from './layers/wick.js';
import * as palette from './palette.js';
import { createScale, type Insets } from './scale.js';
import { haloTexture, softDotTexture } from './textures.js';
import type { Stage, StageOptions, StagePhase, StagePoint } from './types.js';

/**
 * The round, assembled.
 *
 * ## The stage drives itself
 *
 * It owns the ticker and pulls from {@link StageOptions.sample} rather than being
 * pushed at, which is what keeps the whole animation off React: the client's
 * sampler reads a mutable ref the socket writes to, and no frame of a round
 * causes a render. It also detects its own transitions - the crash burst, the
 * volley, the reset between rounds - so the component holds no `useRef`
 * bookkeeping about what has already fired.
 */

/** Room for the axis labels on the left, and for the round's tip everywhere else. */
const INSETS: Insets = { left: 40, right: 15, top: 20, bottom: 28 };

/** How long the screen stays washed red after a crash, in frames. */
const FLASH_FRAMES = 60;

const BACKGROUND = 0x0a0a0a;

/**
 * How long to wait for a renderer before giving up.
 *
 * `Application.init()` can **hang without resolving or throwing** when the
 * browser has no usable GPU - reproduced with a five-line PIXI page under
 * ANGLE/SwiftShader, where it never settles and logs nothing. Left alone that is
 * the worst failure this scene has: a black rectangle where the round should be,
 * and no clue in the console. A rejection at least reaches the caller's `catch`.
 */
const INIT_TIMEOUT_MS = 10_000;

/** The tip wash, as a multiple of the stage width. */
const GLOW_SPAN = 0.64;

/**
 * The slope of the curve at its tip, in screen space, for the rocket's lean.
 * Sampled over a few points because one frame's delta is mostly noise.
 */
const slopeAt = (
  points: readonly StagePoint[],
  x: (elapsed: number, span: number) => number,
  y: (multiplier: number) => number,
): number => {
  if (points.length < 2) return 0;
  const last = points[points.length - 1] as StagePoint;
  const back = points[Math.max(0, points.length - 6)] as StagePoint;
  const dx = x(last.elapsed, last.elapsed) - x(back.elapsed, last.elapsed);
  if (dx <= 0.001) return 0;
  return (y(last.multiplier) - y(back.multiplier)) / dx;
};

export const createStage = async (options: StageOptions): Promise<Stage> => {
  const { container, sample } = options;

  const app = new Application();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = app.init({
    background: BACKGROUND,
    antialias: true,
    resolution: Math.min(globalThis.devicePixelRatio ?? 1, 2),
    autoDensity: true,
    resizeTo: container,
  });
  await Promise.race([
    started,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('PIXI could not start a renderer')),
        INIT_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));

  // Filled into the box rather than laid out by it: the readouts sit over the
  // top in their own absolutely-positioned layer.
  app.canvas.style.position = 'absolute';
  app.canvas.style.inset = '0';
  app.canvas.style.display = 'block';
  container.appendChild(app.canvas);

  const dot = softDotTexture();
  const halo = haloTexture();

  const scale = createScale(INSETS);
  const starfield = createStarfield(dot);
  const grid = createGrid();
  const curve = createCurve();
  const embers = createEmbers(dot);
  const wick = createWick(dot, halo);
  const fireworks = createFireworks(dot);
  const rocket = await createRocket(options.rocketUrl);

  // The tip wash and the crash flash: two full-bleed halo sprites under
  // everything, tinted per frame. Cheaper than the radial gradients they replace
  // and, being sprites, they can be moved rather than redrawn.
  const wash = new Sprite(halo);
  wash.anchor.set(0.5);
  wash.alpha = 0;

  const flash = new Sprite(halo);
  flash.anchor.set(0.5);
  flash.tint = palette.FLASH;
  flash.alpha = 0;

  const world = new Container();
  world.addChild(
    wash,
    flash,
    starfield.view,
    grid.view,
    curve.view,
    embers.view,
    wick.view,
    rocket.view,
    fireworks.view,
  );
  app.stage.addChild(world);

  let previousPhase: StagePhase | null = null;
  let flashLeft = 0;
  let crashedAt = 1;
  /**
   * The crash burst is armed on the transition and spent on the next frame,
   * because only the frame knows where the tip ended up. Armed rather than fired
   * immediately is also what stops it repeating for every frame of the crashed
   * phase, which is the bookkeeping the component used to hold in a ref.
   */
  let burstPending = false;

  const sizeOf = () => ({
    width: app.renderer.width / app.renderer.resolution,
    height: app.renderer.height / app.renderer.resolution,
  });

  const enter = (phase: StagePhase, width: number, height: number): void => {
    if (phase === 'waiting' || phase === 'idle') {
      // A fresh round: drop the last one's debris and put the axis back.
      burstPending = false;
      scale.reset();
      curve.clear();
      embers.clear();
      wick.clear();
      fireworks.clear();
      flashLeft = 0;
    }
    if (phase === 'running') {
      fireworks.clear();
      wick.dim();
    }
    if (phase === 'crashed') {
      flashLeft = FLASH_FRAMES;
      burstPending = true;
      wick.dim();
      rocket.hide();
      fireworks.launch(width, height, scale.plot.left, scale.plot.right);
    }
  };

  const frame = (): void => {
    const { width, height } = sizeOf();
    if (width === 0 || height === 0) return;

    scale.resize(width, height);

    const { phase, multiplier, points } = sample();
    if (phase !== previousPhase) {
      if (phase === 'crashed') crashedAt = multiplier;
      enter(phase, width, height);
      previousPhase = phase;
    }

    const running = phase === 'running';
    const crashed = phase === 'crashed';
    if (running) scale.follow(multiplier);

    starfield.update(phase, width, height);
    grid.update(scale);
    curve.update(scale, points, crashed);

    const last = points[points.length - 1];
    const tipX =
      last === undefined ? width / 2 : scale.x(last.elapsed, last.elapsed);
    const tipY = last === undefined ? scale.y(1) : scale.y(last.multiplier);

    // The ambient wash follows the tip and warms with the round.
    if (running) {
      const glow = palette.glowFor(multiplier);
      wash.x = tipX;
      wash.y = tipY;
      wash.width = width * GLOW_SPAN * 2;
      wash.height = wash.width;
      wash.tint = glow.color;
      // Scaled up hard, because the source texture's own falloff is what makes
      // this read as light rather than as a circle.
      wash.alpha = glow.alpha * 6;
    } else {
      wash.alpha = 0;
    }

    if (flashLeft > 0) {
      flash.x = width / 2;
      flash.y = height / 2;
      flash.width = Math.max(width, height) * 2.4;
      flash.height = flash.width;
      flash.alpha = (flashLeft / FLASH_FRAMES) * 0.5;
      flashLeft -= 1;
    } else {
      flash.alpha = 0;
    }

    if (running) {
      const slope = slopeAt(
        points,
        (elapsed, span) => scale.x(elapsed, span),
        (m) => scale.y(m),
      );
      rocket.place(tipX, tipY, slope, true);
      wick.spark(rocket.wickX, rocket.wickY);
      embers.trail(tipX, tipY, multiplier);
    } else if (phase === 'waiting' || phase === 'idle') {
      // Parked mid-plot with the fuse lit, which is what the countdown is about.
      rocket.place(width / 2, height / 2, 0, false);
      wick.glow(rocket.wickX, rocket.wickY);
    }

    if (burstPending) {
      embers.burst(tipX, tipY, crashedAt);
      burstPending = false;
    }

    embers.advance(crashed);
    wick.advance();
    fireworks.advance();
  };

  app.ticker.add(frame);

  return {
    destroy(): void {
      app.ticker.remove(frame);
      // `removeView` takes the canvas out of the DOM with it. The stage made
      // that element, so the stage is what cleans it up.
      app.destroy({ removeView: true }, { children: true });
    },
  };
};
