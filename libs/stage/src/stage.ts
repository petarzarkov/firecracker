import { Application, Container, Sprite, type Ticker } from 'pixi.js';
import { createBoarders } from './layers/boarding.js';
import { createCurve } from './layers/curve.js';
import { createDetonation, type Motion } from './layers/detonation.js';
import { createEmbers } from './layers/embers.js';
import { createFireworks } from './layers/fireworks.js';
import { createGrid } from './layers/grid.js';
import { createParachutes } from './layers/parachutes.js';
import { createRocket, tensionAt } from './layers/rocket.js';
import { createStarfield } from './layers/starfield.js';
import { createWick } from './layers/wick.js';
import * as palette from './palette.js';
import { createScale, type Insets, spriteZoom } from './scale.js';
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
 * How long the fireworks wait.
 *
 * They used to launch on the crash frame, so six shells climbed *through* the
 * explosion and the two read as one busy mess. Held until the fireball is past its
 * peak, they become the next beat instead of a competing one.
 */
const FIREWORKS_DELAY = 46;

const BACKGROUND = 0x0a0a0a;

/**
 * What a crash does to somebody who has asked for less motion.
 *
 * `prefers-reduced-motion` appeared nowhere in this scene, and a crash fires a
 * full-screen red wash and shakes the whole plot for 26 frames - which is the exact
 * pair that motion and photosensitivity guidance asks you to gate. The fireball
 * stays: it is local, it is the event, and removing it would leave a round that
 * simply stopped. The screen-wide parts go.
 */
const REDUCED = { flash: 0.12, shake: 0 } as const;
const FULL = { flash: 0.55, shake: 8 } as const;

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

  const calmQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let motion: Motion = calmQuery?.matches === true ? REDUCED : FULL;
  const onMotionChange = (): void => {
    motion = calmQuery?.matches === true ? REDUCED : FULL;
  };
  calmQuery?.addEventListener('change', onMotionChange);

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
  const boarders = await createBoarders(dot, options.boarderUrl);

  /**
   * The tip wash: a full-bleed halo sprite under everything, tinted per frame.
   * Cheaper than the radial gradient it replaces and, being a sprite, it can be
   * moved rather than redrawn.
   */
  const wash = new Sprite(halo);
  wash.anchor.set(0.5);
  wash.alpha = 0;

  const detonation = createDetonation(halo);

  const world = new Container();
  world.addChild(
    wash,
    detonation.under,
    starfield.view,
    grid.view,
    curve.view,
    // Over the plot, not under it. The fireball used to sit beneath the gridlines
    // and the curve, which is right for ambient light and wrong for the one thing
    // on screen that is supposed to be violent.
    detonation.over,
    embers.view,
    wick.view,
    rocket.view,
    // Over the rocket: they are climbing into the near side of it, and the last
    // thing a boarder does is disappear behind the hull's own silhouette.
    boarders.view,
    fireworks.view,
    // Over everything: a cash-out is the thing a player most wants to see, and
    // it carries text that has to stay legible against a lit plot.
    parachutes.view,
  );
  app.stage.addChild(world);

  let previousPhase: StagePhase | null = null;
  let crashedAt = 1;
  /** Where the rocket was when it went. The embers burst from here too. */
  let blastX = 0;
  let blastY = 0;
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
      fireworksIn = 0;
      detonation.clear();
      rocket.hide();
      parachutes.clear();
      boarders.clear();
      scale.reset();
      curve.clear();
      embers.clear();
      wick.clear();
      fireworks.clear();
    }
    if (phase === 'running') {
      fireworks.clear();
      /**
       * The doors close at the launch.
       *
       * A boarder is drawn by easing from where it started toward the rocket's
       * *current* position, so the rocket leaving the middle of the plot for the
       * curve's tip drags anybody still climbing sideways with it - a jump of a
       * good fraction of the plot on one frame. Anyone in the air when the round
       * starts is simply aboard.
       */
      boarders.clear();
      // No `wick.dim()` here: `wick.flame` takes over from `wick.glow` and grows
      // with the round, and dimming left the rocket climbing with an unlit fuse.
    }
    if (phase === 'crashed') {
      burstPending = true;
      // Captured before the rocket is thrown: this is the last place a player saw
      // it under power, which is where they expect the explosion.
      blastX = rocket.x;
      blastY = rocket.y;
      detonation.fire(blastX, blastY);
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

    const { phase, multiplier, elapsed, points, curveAt, waitingLeft } =
      sample();
    if (phase !== previousPhase) {
      if (phase === 'crashed') crashedAt = multiplier;
      enter(phase);
      previousPhase = phase;
    }

    const running = phase === 'running';
    const crashed = phase === 'crashed';
    // Every sprite in this scene is sized against a desktop plot; this is what
    // keeps the rocket off the multiplier readout on a 320px phone.
    const zoom = spriteZoom(scale.plot.height);
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

    const shake = detonation.advance(delta, width, height, motion);
    world.x = shake.x;
    world.y = shake.y;

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
      const restY = Math.max(tipY, ROCKET_MARGIN_Y * zoom);
      const slope = slopeAt(
        points,
        head,
        (at, span) => scale.x(at, span),
        (m) => scale.y(m),
      );
      rocket.place(tipX, restY, slope, delta, zoom);
      wick.flame(
        rocket.wickX,
        rocket.wickY,
        multiplier,
        rocket.angle,
        delta,
        zoom,
      );
      // The trail comes off the curve, not the nudged sprite.
      embers.trail(tipX, tipY, multiplier, delta);
    } else if (phase === 'waiting' || phase === 'idle') {
      // Held mid-plot with the fuse burning down, straining harder the closer the
      // launch gets - which is what the countdown over it is about. `idle` rather
      // than `place`: the whole point is that it does not sit still.
      const tension = phase === 'waiting' ? tensionAt(waitingLeft) : 0;
      rocket.idle(width / 2, height / 2, tension, delta, zoom);
      wick.glow(rocket.wickX, rocket.wickY, tension, delta, zoom);
    } else if (crashed) {
      // Nothing places it any more - it is falling under its own momentum.
      rocket.tumble(delta);
    }

    if (burstPending) {
      embers.burst(blastX, blastY, crashedAt);
      burstPending = false;
    }

    // Boarders fly to wherever the rocket is *this* frame, which during the
    // window is a moving target - it hovers, and it lurches every time one of
    // them lands.
    for (const boarding of options.takeBoardings?.() ?? []) {
      boarders.board(boarding, rocket.x, height, zoom);
    }
    const aboard = boarders.advance(delta, rocket.x, rocket.y);
    if (aboard > 0) rocket.recoil(aboard);

    // Jumpers leave from wherever the rocket is - the round is still climbing and
    // somebody has just stepped off it.
    for (const cashOut of options.takeCashOuts?.() ?? []) {
      parachutes.drop(cashOut, rocket.x, rocket.y, zoom);
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
      calmQuery?.removeEventListener('change', onMotionChange);
      app.ticker.remove(onTick);
      // `removeView` takes the canvas out of the DOM with it. The stage made
      // that element, so the stage is what cleans it up.
      app.destroy({ removeView: true }, { children: true });
    },
  };
};
