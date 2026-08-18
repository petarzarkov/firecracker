import { Application, Container, Sprite, type Ticker } from 'pixi.js';
import { createCurve } from './layers/curve.js';
import { createEmbers } from './layers/embers.js';
import { createFireworks } from './layers/fireworks.js';
import { createGrid } from './layers/grid.js';
import { createParachutes } from './layers/parachutes.js';
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

/**
 * Room for the axis labels on the left, and for the rocket on the right.
 *
 * The curve's leading edge is always the plot's right edge, so the rocket sitting
 * on it needs half its own width of margin or it is drawn half off the canvas -
 * which is exactly what a 15px inset did. The trail spawns there too, and had
 * been flying straight out of frame.
 */
const INSETS: Insets = { left: 40, right: 62, top: 20, bottom: 28 };

/** How long the screen stays washed red after a crash, in frames. */
const FLASH_FRAMES = 60;

/** How long the fireball itself lasts, and how wide it opens. */
const BLAST_FRAMES = 26;
const BLAST_SIZE = [40, 340] as const;

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
 * The largest frame step the simulations are asked to take.
 *
 * A backgrounded tab, a garbage collection or a slow first frame can hand the
 * ticker a delta of many frames at once, and every velocity here is integrated
 * by multiplication - so an unclamped step teleports the whole trail across the
 * plot in one frame. Two frames of catch-up is enough to hide a hitch.
 */
const MAX_DELTA = 2;

/** Half the running sprite's height, so it never hangs off the top edge. */
const ROCKET_MARGIN_Y = 78;

/**
 * The slope of the curve at its tip, in screen space, for the rocket's lean.
 * Sampled over a few points because one frame's delta is mostly noise.
 */
const slopeAt = (
  points: readonly StagePoint[],
  head: StagePoint,
  x: (elapsed: number, span: number) => number,
  y: (multiplier: number) => number,
): number => {
  if (points.length < 2) return 0;
  const back = points[Math.max(0, points.length - 6)] as StagePoint;
  const dx = x(head.elapsed, head.elapsed) - x(back.elapsed, head.elapsed);
  if (dx <= 0.001) return 0;
  return (y(head.multiplier) - y(back.multiplier)) / dx;
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
  const parachutes = await createParachutes(options.parachutistUrl);

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

  /**
   * The explosion itself: a hot disc that expands and fades where the rocket
   * was.
   *
   * It used to be a `💥` in the DOM, centred in the chart box - so the rocket
   * blew up in the middle of the screen no matter where it had climbed to, which
   * on a good round was nowhere near it.
   */
  const blast = new Sprite(halo);
  blast.anchor.set(0.5);
  blast.alpha = 0;

  const world = new Container();
  world.addChild(
    wash,
    flash,
    blast,
    starfield.view,
    grid.view,
    curve.view,
    embers.view,
    wick.view,
    rocket.view,
    fireworks.view,
    // Over everything: a cash-out is the thing a player most wants to see, and
    // it carries text that has to stay legible against a lit plot.
    parachutes.view,
  );
  app.stage.addChild(world);

  let previousPhase: StagePhase | null = null;
  let flashLeft = 0;
  let crashedAt = 1;
  /** Where the rocket was when it went. The blast and the flash centre here. */
  let blastX = 0;
  let blastY = 0;
  let blastLeft = 0;
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
      blastLeft = 0;
      parachutes.clear();
      scale.reset();
      curve.clear();
      embers.clear();
      wick.clear();
      fireworks.clear();
      flashLeft = 0;
    }
    if (phase === 'running') {
      fireworks.clear();
      // The fuse stays lit - `wick.flame` takes over from `wick.glow` and grows
      // with the round. Dimming it here is what left the rocket flying with an
      // unlit fuse for the whole climb.
    }
    if (phase === 'crashed') {
      flashLeft = FLASH_FRAMES;
      burstPending = true;
      // Captured before the sprite is hidden: this is the last place a player
      // saw it, which is where they expect the explosion.
      blastX = rocket.x;
      blastY = rocket.y;
      blastLeft = BLAST_FRAMES;
      wick.dim();
      rocket.hide();
      fireworks.launch(width, height, scale.plot.left, scale.plot.right);
    }
  };

  const frame = (rawDelta: number): void => {
    const { width, height } = sizeOf();
    if (width === 0 || height === 0) return;

    const delta = Math.min(rawDelta, MAX_DELTA);
    scale.resize(width, height);

    const { phase, multiplier, elapsed, points, curveAt } = sample();
    if (phase !== previousPhase) {
      if (phase === 'crashed') crashedAt = multiplier;
      enter(phase, width, height);
      previousPhase = phase;
    }

    const running = phase === 'running';
    const crashed = phase === 'crashed';
    if (running) scale.follow(multiplier);

    /**
     * Where the round is *now*, not where the last tick left it.
     *
     * The server ticks ten times a second; the caller's clock interpolates
     * between them. Everything on the leading edge - the curve's last segment,
     * the rocket, the wash, the trail - hangs off this, which is the difference
     * between a line that grows and a line that steps.
     *
     * Past the crash the head stops moving: `elapsed` keeps climbing from the
     * client's clock, and a tip that kept travelling after the explosion would
     * draw a round that did not happen.
     */
    const last = points[points.length - 1];
    const head: StagePoint = (() => {
      if (!running || last === undefined) {
        return last ?? { elapsed: 0, multiplier: 1 };
      }
      const at = Math.max(elapsed, last.elapsed);
      /**
       * Read off the curve rather than from `multiplier`.
       *
       * `sample().multiplier` is what the player would be paid, and the server
       * pays in whole hundredths - so it climbs in 0.01 steps, about eight
       * pixels. The line stopped stepping once it was sampled from `curveAt`,
       * but everything hanging off the head - the rocket, the flame, the wash -
       * was still riding the rounded value and still twitching upward ten times
       * a second.
       */
      return { elapsed: at, multiplier: curveAt?.(at) ?? multiplier };
    })();

    starfield.update(phase, width, height, delta);
    grid.update(scale);
    curve.update(scale, points, head, crashed, curveAt);

    const tipX =
      points.length === 0 ? width / 2 : scale.x(head.elapsed, head.elapsed);
    const tipY = points.length === 0 ? scale.y(1) : scale.y(head.multiplier);

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
      flash.x = blastX;
      flash.y = blastY;
      flash.width = Math.max(width, height) * 2.4;
      flash.height = flash.width;
      flash.alpha = (flashLeft / FLASH_FRAMES) * 0.5;
      flashLeft -= delta;
    } else {
      flash.alpha = 0;
    }

    if (blastLeft > 0) {
      // Opens fast and fades faster, so it reads as a detonation rather than a
      // growing circle: size runs on the square root of its age, alpha on the
      // square of what is left.
      const age = 1 - blastLeft / BLAST_FRAMES;
      const size =
        BLAST_SIZE[0] + (BLAST_SIZE[1] - BLAST_SIZE[0]) * Math.sqrt(age);
      blast.x = blastX;
      blast.y = blastY;
      blast.width = size;
      blast.height = size;
      blast.tint = age < 0.35 ? 0xffe9c0 : palette.FLASH;
      blast.alpha = (blastLeft / BLAST_FRAMES) ** 2;
      blastLeft -= delta;
    } else {
      blast.alpha = 0;
    }

    if (running) {
      /**
       * Kept on the canvas.
       *
       * The sprite is centred on the tip, so a round near its ceiling - a 68x
       * with the axis at 100 - puts half a firecracker above the top edge. The
       * curve's tip stays exactly where it belongs; only the drawing of the
       * rocket is nudged down to stay whole, which reads as it levelling off
       * rather than as a clipped sprite.
       */
      const restY = Math.max(tipY, ROCKET_MARGIN_Y);
      const slope = slopeAt(
        points,
        head,
        (at, span) => scale.x(at, span),
        (m) => scale.y(m),
      );
      rocket.place(tipX, restY, slope, true, delta);
      wick.flame(rocket.wickX, rocket.wickY, multiplier, rocket.angle, delta);
      // The trail comes off the curve, not the nudged sprite.
      embers.trail(tipX, tipY, multiplier, delta);
    } else if (phase === 'waiting' || phase === 'idle') {
      // Parked mid-plot with the fuse lit, which is what the countdown is about.
      rocket.place(width / 2, height / 2, 0, false, delta);
      wick.glow(rocket.wickX, rocket.wickY);
    }

    if (burstPending) {
      embers.burst(blastX, blastY, crashedAt);
      burstPending = false;
    }

    /**
     * Jumpers leave from wherever the rocket is, which is the point: the round
     * is still climbing and somebody has just stepped off it.
     */
    for (const cashOut of options.takeCashOuts?.() ?? []) {
      parachutes.drop(cashOut, rocket.x, rocket.y);
    }
    parachutes.advance(delta, width, height);

    embers.advance(crashed, delta);
    wick.advance(delta);
    fireworks.advance(delta);
  };

  // Named, because `remove` matches on identity - an inline arrow would add a
  // callback the teardown could never take off again.
  const onTick = (ticker: Ticker): void => frame(ticker.deltaTime);
  app.ticker.add(onTick);

  return {
    destroy(): void {
      app.ticker.remove(onTick);
      // `removeView` takes the canvas out of the DOM with it. The stage made
      // that element, so the stage is what cleans it up.
      app.destroy({ removeView: true }, { children: true });
    },
  };
};
