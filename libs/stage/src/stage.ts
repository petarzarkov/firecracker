import { Application, Container, Graphics, Sprite, type Ticker } from 'pixi.js';
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
 * The round, assembled. **The stage drives itself:** it owns the ticker and pulls
 * from {@link StageOptions.sample} rather than being pushed at, which keeps the
 * animation off React entirely - no frame of a round causes a render. It detects
 * its own transitions too, so the component holds no bookkeeping about what has
 * already fired.
 */

/**
 * Room for the axis labels left, and for the rocket right. The curve's leading edge
 * is always the plot's right edge, so the rocket on it needs half its own width or
 * it draws off the canvas - and the trail spawns there too.
 */
const INSETS: Insets = { left: 40, right: 62, top: 20, bottom: 28 };

/**
 * The crash, as a sequence rather than as a moment.
 *
 * It used to be two things on one frame - a 26-frame fireball and a `rocket.hide()`
 * - which is about four tenths of a second for the whole event, most of it spent
 * fading. The rocket was simply gone, so there was nothing to watch being destroyed,
 * and the fireball's alpha ran on the *square* of its remaining life, so it was down
 * to a quarter brightness a fifth of a second in. Together that is the "poof".
 *
 * What replaces it is staged, and the stages deliberately overlap: a white core at
 * the point of detonation, a ring leaving it, the fireball opening behind that, the
 * wreck thrown clear and tumbling, cinders arcing over, and a warm residue that
 * outlives all of it. Nothing here outruns the crashed phase: the server holds it
 * for `GAME_COOLDOWN_MS`, five seconds by default, and the longest thing below is
 * the residue at about two and a third.
 */

/** The white-hot instant. Short on purpose: it is the thing the ring leaves behind. */
const CORE_FRAMES = 14;
const CORE_SIZE = [26, 190] as const;

/** How long the fireball itself lasts, and how wide it opens. */
const BLAST_FRAMES = 66;
const BLAST_SIZE = [44, 470] as const;

/** The pressure ring. Outruns the fireball, which is what gives the blast a scale. */
const SHOCK_FRAMES = 40;
const SHOCK_RADIUS = 430;
const SHOCK_WIDTH = 7;

/** How long the screen stays washed red after a crash, in frames. */
const FLASH_FRAMES = 78;

/** The residue: swells as the fireball dies, then goes. */
const AFTERGLOW_FRAMES = 140;
const AFTERGLOW_SIZE = [240, 540] as const;

/** The kick, in pixels of whole-scene displacement, and how long it rings for. */
const SHAKE_FRAMES = 26;
const SHAKE_MAX = 8;

/**
 * How long the fireworks wait.
 *
 * They used to launch on the crash frame, so six shells climbed *through* the
 * explosion and the two read as one busy mess. Held until the fireball is past its
 * peak, they become the next beat instead of a competing one.
 */
const FIREWORKS_DELAY = 46;

const BACKGROUND = 0x0a0a0a;

/**
 * `Application.init()` can **hang without resolving or throwing** when the browser
 * has no usable GPU, leaving a black rectangle and nothing in the console. A
 * rejection at least reaches the caller's `catch`.
 */
const INIT_TIMEOUT_MS = 10_000;

/** The tip wash, as a multiple of the stage width. */
const GLOW_SPAN = 0.64;

/**
 * A backgrounded tab or a slow first frame hands the ticker many frames at once,
 * and every velocity here is integrated by multiplication - so an unclamped step
 * teleports the trail across the plot.
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

  /**
   * The renderer follows the **box**, not the window.
   *
   * `resizeTo` sounds like it does this and does not: PIXI's resize plugin binds one
   * listener, `globalThis`'s `resize`, and reads the element only when that fires. So
   * every way this container changes size on its own leaves the renderer at whatever
   * it measured during `init()` - the bet panel below it growing a row, a mobile
   * address bar collapsing, or simply the layout settling while `createStage` was
   * still awaiting a renderer, which is the common one because the whole module is
   * imported dynamically.
   *
   * Stale, it draws the plot into the top-left corner of a larger box and the rest
   * stays flat black - and because the canvas clears to the same colour the container
   * is painted, there is no visible seam to say so. It reads as "the grid did not
   * scale".
   */
  const observer = new ResizeObserver(() => app.resize());
  observer.observe(container);

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

  // The residue, under the plot with the other ambient light.
  const afterglow = new Sprite(halo);
  afterglow.anchor.set(0.5);
  afterglow.tint = palette.AFTERGLOW;
  afterglow.alpha = 0;

  const flash = new Sprite(halo);
  flash.anchor.set(0.5);
  flash.tint = palette.FLASH;
  flash.alpha = 0;

  // A hot disc that expands and fades where the rocket actually was, rather than
  // in the middle of the chart box.
  const blast = new Sprite(halo);
  blast.anchor.set(0.5);
  blast.alpha = 0;

  // The white centre of it, and the ring leaving that centre.
  const core = new Sprite(halo);
  core.anchor.set(0.5);
  core.tint = palette.BLAST_CORE;
  core.alpha = 0;

  const shock = new Graphics();

  const world = new Container();
  world.addChild(
    wash,
    flash,
    afterglow,
    starfield.view,
    grid.view,
    curve.view,
    // Over the plot, not under it. The fireball used to sit beneath the gridlines
    // and the curve, which is right for ambient light and wrong for the one thing
    // on screen that is supposed to be violent.
    blast,
    shock,
    core,
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
  let coreLeft = 0;
  let shockLeft = 0;
  let afterglowLeft = 0;
  let shakeLeft = 0;
  let fireworksIn = 0;
  /**
   * Armed on the transition, spent on the next frame - only the frame knows where
   * the tip ended up, and arming is also what stops it repeating for every frame of
   * the crashed phase.
   */
  let burstPending = false;

  const sizeOf = () => ({
    width: app.renderer.width / app.renderer.resolution,
    height: app.renderer.height / app.renderer.resolution,
  });

  const enter = (phase: StagePhase): void => {
    if (phase === 'waiting' || phase === 'idle') {
      // A fresh round: drop the last one's debris and put the axis back.
      burstPending = false;
      blastLeft = 0;
      coreLeft = 0;
      shockLeft = 0;
      afterglowLeft = 0;
      shakeLeft = 0;
      fireworksIn = 0;
      shock.clear();
      rocket.hide();
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
      // No `wick.dim()` here: `wick.flame` takes over from `wick.glow` and grows
      // with the round, and dimming left the rocket climbing with an unlit fuse.
    }
    if (phase === 'crashed') {
      flashLeft = FLASH_FRAMES;
      burstPending = true;
      // Captured before the rocket is thrown: this is the last place a player saw
      // it under power, which is where they expect the explosion.
      blastX = rocket.x;
      blastY = rocket.y;
      blastLeft = BLAST_FRAMES;
      coreLeft = CORE_FRAMES;
      shockLeft = SHOCK_FRAMES;
      afterglowLeft = AFTERGLOW_FRAMES;
      shakeLeft = SHAKE_FRAMES;
      fireworksIn = FIREWORKS_DELAY;
      wick.dim();
      // Thrown, not hidden. See `TUMBLE_FRAMES` in the rocket layer.
      rocket.burst();
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
      enter(phase);
      previousPhase = phase;
    }

    const running = phase === 'running';
    const crashed = phase === 'crashed';
    if (running) scale.follow(multiplier);

    /**
     * Where the round is *now*: the server ticks ten times a second and the
     * caller's clock interpolates between them, which is the difference between a
     * line that grows and one that steps. Past the crash the head stops moving, or
     * it would draw a round that did not happen.
     */
    const last = points[points.length - 1];
    const head: StagePoint = (() => {
      if (!running || last === undefined) {
        return last ?? { elapsed: 0, multiplier: 1 };
      }
      const at = Math.max(elapsed, last.elapsed);
      // Off the curve, not from `multiplier`: the payable value moves in whole
      // hundredths, about eight pixels, so anything riding it twitches upward ten
      // times a second even once the line itself is smooth.
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
      flash.alpha = (flashLeft / FLASH_FRAMES) ** 1.3 * 0.55;
      flashLeft -= delta;
    } else {
      flash.alpha = 0;
    }

    if (blastLeft > 0) {
      const age = 1 - blastLeft / BLAST_FRAMES;
      const size =
        BLAST_SIZE[0] + (BLAST_SIZE[1] - BLAST_SIZE[0]) * Math.sqrt(age);
      blast.x = blastX;
      blast.y = blastY;
      blast.width = size;
      blast.height = size;
      blast.tint = palette.blastTintFor(age);
      /**
       * An attack, then a decay - not a decay alone.
       *
       * Starting at full brightness makes it a flashbulb: the brightest frame is
       * the first one, before it has opened to any size, so what a player sees is a
       * dot and then a fade. Ramping over the first tenth means the peak lands
       * where the fireball is actually big.
       */
      blast.alpha = Math.min(1, age / 0.1) * (1 - age) ** 1.4;
      blastLeft -= delta;
    } else {
      blast.alpha = 0;
    }

    if (coreLeft > 0) {
      const remaining = coreLeft / CORE_FRAMES;
      const size =
        CORE_SIZE[0] + (CORE_SIZE[1] - CORE_SIZE[0]) * Math.sqrt(1 - remaining);
      core.x = blastX;
      core.y = blastY;
      core.width = size;
      core.height = size;
      core.alpha = remaining ** 0.6;
      coreLeft -= delta;
    } else {
      core.alpha = 0;
    }

    if (shockLeft > 0) {
      // Cubic ease-out: the ring leaves at speed and settles, which is the whole
      // reason it reads as pressure rather than as a growing circle.
      const age = 1 - shockLeft / SHOCK_FRAMES;
      const radius = 18 + SHOCK_RADIUS * (1 - (1 - age) ** 3);
      shock.clear();
      shock.circle(blastX, blastY, radius).stroke({
        width: Math.max(1, SHOCK_WIDTH * (1 - age)),
        color: palette.SHOCKWAVE,
        alpha: (1 - age) ** 1.4 * 0.8,
      });
      shockLeft -= delta;
      if (shockLeft <= 0) shock.clear();
    }

    if (afterglowLeft > 0) {
      // Swells and subsides rather than fading from full, so it arrives as the
      // fireball leaves instead of being another thing decaying alongside it.
      const age = 1 - afterglowLeft / AFTERGLOW_FRAMES;
      const size =
        AFTERGLOW_SIZE[0] + (AFTERGLOW_SIZE[1] - AFTERGLOW_SIZE[0]) * age;
      afterglow.x = blastX;
      afterglow.y = blastY;
      afterglow.width = size;
      afterglow.height = size;
      afterglow.alpha = Math.sin(Math.PI * age) * 0.3;
      afterglowLeft -= delta;
    } else {
      afterglow.alpha = 0;
    }

    /**
     * The kick, applied to the whole scene.
     *
     * Re-rolled every frame rather than eased along a path: a smooth displacement
     * reads as the chart sliding, and jitter is what reads as an impact. Squared,
     * so it is violent for a handful of frames and then simply over - and zeroed
     * exactly, because a scene left a third of a pixel off centre never recovers.
     */
    if (shakeLeft > 0) {
      const power = SHAKE_MAX * (shakeLeft / SHAKE_FRAMES) ** 2;
      world.x = (Math.random() - 0.5) * 2 * power;
      world.y = (Math.random() - 0.5) * 2 * power;
      shakeLeft -= delta;
      if (shakeLeft <= 0) {
        world.x = 0;
        world.y = 0;
      }
    }

    if (fireworksIn > 0) {
      fireworksIn -= delta;
      if (fireworksIn <= 0) {
        fireworksIn = 0;
        fireworks.launch(width, height, scale.plot.left, scale.plot.right);
      }
    }

    if (running) {
      // The sprite is centred on the tip, so a round near the axis ceiling puts
      // half a firecracker off the top edge. Only the *drawing* is nudged down -
      // the curve's tip stays where it belongs - which reads as levelling off.
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
    } else if (crashed) {
      // Nothing places it any more - it is falling under its own momentum.
      rocket.tumble(delta);
    }

    if (burstPending) {
      embers.burst(blastX, blastY, crashedAt);
      burstPending = false;
    }

    // Jumpers leave from wherever the rocket is - the round is still climbing and
    // somebody has just stepped off it.
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
      observer.disconnect();
      app.ticker.remove(onTick);
      // `removeView` takes the canvas out of the DOM with it. The stage made
      // that element, so the stage is what cleans it up.
      app.destroy({ removeView: true }, { children: true });
    },
  };
};
