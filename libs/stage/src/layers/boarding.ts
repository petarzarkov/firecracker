import { Assets, Container, Sprite, Text, type Texture } from 'pixi.js';
import { createMotePool, type MotePool } from '../pool.js';
import * as palette from '../palette.js';
import type { StageBoarding } from '../types.js';

/**
 * Everyone who just bet, flying up and climbing into the rocket - the mirror of
 * `parachutes.ts`, which is how they leave.
 *
 * The betting window is the longest stretch a player spends looking at this chart
 * and nothing used to happen in it: the rocket sat still, and a bet was a row
 * appearing in a list off to the side. A lobby filling up is the one thing during
 * the wait that is actually news, so it happens on the rocket.
 *
 * Pooled and recycled for the same reason the canopies are: bots and players can
 * bet in the same instant, and allocating sprites then is the worst time to do it.
 */

/** Boarders in the air at once. Beyond this the oldest is recycled. */
const CAPACITY = 12;

/** How long one climb takes, in 60fps frames. */
const FLIGHT_FRAMES = 76;

/**
 * How far apart two boarders that arrived in the same frame are launched, in
 * frames. Bots bet in bursts, and without it a burst is one silhouette - at eleven
 * frames it still was, because four of them were within a rocket's width of each
 * other for most of the climb. See the note on the ease in {@link flightAt}.
 */
const STAGGER_FRAMES = 17;

/** How far under the bottom edge they start, so nobody pops into view. */
const SPAWN_BELOW = 46;

/** How far to either side of the rocket they launch from. */
const SPAWN_SPREAD = 300;

/** How high the leap bows away from the straight line. */
const ARC = [60, 150] as const;

const FIGURE_HEIGHT = 58;

/** What is left of them as they disappear through the hatch. */
const ARRIVE_SCALE = 0.3;

/** How far the figure leans into its own flight. Radians. */
const MAX_LEAN = 0.7;

/** The puff of dust as somebody gets in. */
const PUFF_MOTES = 12;
const PUFF_CAPACITY = 64;
const PUFF_SPEED = 2.6;
const PUFF_DRAG = 0.9;

const LABEL_STYLE = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: 12,
  fontWeight: '700' as const,
  fill: palette.BOARDING_TEXT,
  align: 'center' as const,
};

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Where a boarder is, `progress` of the way through its climb.
 *
 * **Even along the path, bowed above it.** The first version eased out - fast off
 * the launch, slow at the hatch - which is what a jump feels like and which put
 * every boarder within a rocket's width of the hull for two thirds of its flight.
 * A lobby of four arriving together was one clump of overlapping sprites with three
 * illegible labels stacked over it, which is the shape of the thing the animation
 * exists to avoid. Pacing them evenly spreads a crowd back out along the arc.
 *
 * **It lands exactly on the target at `1`** whatever the arc, because the puff and
 * the rocket's recoil both happen there - a boarder finishing a few pixels beside
 * the hull is a player left standing on nothing.
 */
export const flightAt = (
  progress: number,
  from: Point,
  to: Point,
  arc: number,
): Point => {
  const t = Math.max(0, Math.min(1, progress));
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * arc,
  };
};

export interface Boarders {
  readonly view: Container;
  /**
   * Send somebody up from below the plot toward `x`. Only the horizontal is taken
   * from the rocket: they launch from under the bottom edge whatever height it is
   * hovering at, and {@link advance} is what steers them to it.
   */
  board(boarding: StageBoarding, x: number, height: number): void;
  /**
   * Advances every climb toward `(x, y)` - the rocket's **current** position, which
   * bobs and rumbles while they are in the air. Returns how many got in this frame,
   * which is what the rocket takes its recoil from.
   */
  advance(delta: number, x: number, y: number): number;
  clear(): void;
}

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

interface Boarder {
  from: Point;
  arc: number;
  /** Frames left of the climb. `0` means the slot is free. */
  life: number;
  /** Frames before it launches. See {@link STAGGER_FRAMES}. */
  delay: number;
  x: number;
  y: number;
  sprite: Sprite | null;
  label: Text;
}

export const createBoarders = async (
  dot: Texture,
  url?: string,
): Promise<Boarders> => {
  const view = new Container();

  let texture: Texture | null = null;
  if (url !== undefined) {
    texture = await Assets.load<Texture>(url).catch(() => null);
  }
  const aspect =
    texture === null || texture.height === 0
      ? 1
      : texture.width / texture.height;

  const puff: MotePool = createMotePool(PUFF_CAPACITY, dot);
  view.addChild(puff.view);

  const boarders: Boarder[] = [];
  for (let i = 0; i < CAPACITY; i++) {
    const sprite = texture === null ? null : new Sprite(texture);
    if (sprite !== null) {
      sprite.anchor.set(0.5);
      sprite.height = FIGURE_HEIGHT;
      sprite.width = FIGURE_HEIGHT * aspect;
      sprite.visible = false;
      view.addChild(sprite);
    }

    const label = new Text({ text: '', style: LABEL_STYLE });
    label.anchor.set(0.5, 1);
    label.visible = false;
    view.addChild(label);

    boarders.push({
      from: { x: 0, y: 0 },
      arc: 0,
      life: 0,
      delay: 0,
      x: 0,
      y: 0,
      sprite,
      label,
    });
  }

  let cursor = 0;

  /** A free slot, or the oldest occupied one when the sky is full. */
  const claim = (): Boarder => {
    for (let i = 0; i < CAPACITY; i++) {
      const boarder = boarders[(cursor + i) % CAPACITY] as Boarder;
      if (boarder.life <= 0) {
        cursor = (cursor + i + 1) % CAPACITY;
        return boarder;
      }
    }
    const boarder = boarders[cursor] as Boarder;
    cursor = (cursor + 1) % CAPACITY;
    return boarder;
  };

  const hide = (boarder: Boarder): void => {
    boarder.label.visible = false;
    if (boarder.sprite !== null) boarder.sprite.visible = false;
  };

  /** How many are already queued, so the next one launches behind them. */
  const waiting = (): number =>
    boarders.reduce((count, one) => count + (one.delay > 0 ? 1 : 0), 0);

  return {
    view,

    board(boarding, x, height): void {
      const boarder = claim();
      boarder.from = {
        x: x + (Math.random() - 0.5) * SPAWN_SPREAD,
        y: height + SPAWN_BELOW,
      };
      boarder.arc = ARC[0] + Math.random() * (ARC[1] - ARC[0]);
      boarder.life = FLIGHT_FRAMES;
      // Zeroed before the count, or a recycled slot that was itself still queued
      // counts itself and lands behind a boarder that no longer exists.
      boarder.delay = 0;
      boarder.delay = waiting() * STAGGER_FRAMES;
      boarder.x = boarder.from.x;
      boarder.y = boarder.from.y;

      boarder.label.text = `${boarding.name}\n${money(boarding.betAmountCents)}`;
      hide(boarder);
    },

    advance(delta, x, y): number {
      const target: Point = { x, y };
      let aboard = 0;

      for (const boarder of boarders) {
        if (boarder.life <= 0) continue;

        if (boarder.delay > 0) {
          boarder.delay -= delta;
          continue;
        }

        boarder.life -= delta;
        if (boarder.life <= 0) {
          // Landed: the puff happens at the hatch rather than where the sprite
          // last drew, so it stays on the rocket even at the end of a fast climb.
          for (let i = 0; i < PUFF_MOTES; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * PUFF_SPEED + 0.4;
            puff.spawn({
              x,
              y,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              life: Math.floor(Math.random() * 14) + 12,
              size: Math.random() * 1.6 + 0.8,
              tint:
                palette.WICK_SPARKS[
                  Math.floor(Math.random() * palette.WICK_SPARKS.length)
                ] ?? palette.WICK_HALO,
            });
          }
          hide(boarder);
          aboard += 1;
          continue;
        }

        const progress = 1 - boarder.life / FLIGHT_FRAMES;
        const at = flightAt(progress, boarder.from, target, boarder.arc);
        const dx = at.x - boarder.x;
        const dy = at.y - boarder.y;
        boarder.x = at.x;
        boarder.y = at.y;

        // Faded in over the first moments and out as they go through the hatch.
        const alpha = Math.min(1, progress * 10, (1 - progress) * 7);

        if (boarder.sprite !== null) {
          boarder.sprite.visible = true;
          boarder.sprite.x = at.x;
          boarder.sprite.y = at.y;
          // Leaning into the direction of travel, clamped: the last frames of a
          // climb are nearly horizontal, and an unclamped heading lays the figure
          // flat on its side just as it arrives.
          boarder.sprite.rotation = Math.max(
            -MAX_LEAN,
            Math.min(MAX_LEAN, Math.atan2(dx, -dy)),
          );
          // Shrinking on the square, so it happens at the hull rather than over
          // the whole climb - which would read as flying away, not toward.
          const scale = 1 - (1 - ARRIVE_SCALE) * progress ** 2;
          boarder.sprite.height = FIGURE_HEIGHT * scale;
          boarder.sprite.width = FIGURE_HEIGHT * aspect * scale;
          boarder.sprite.alpha = alpha;
        }

        boarder.label.visible = true;
        boarder.label.x = at.x;
        boarder.label.y = at.y - FIGURE_HEIGHT * 0.55;
        // The name goes before the figure does: it is unreadable over the rocket
        // anyway, and labels are what collide first when several people board at
        // once - they are wider than the sprites they belong to. Held to the
        // halfway mark, which is as long as it can stay and still clear the hull;
        // the first half of the climb is partly below the canvas, so anything much
        // shorter than this is a name nobody can read.
        boarder.label.alpha = alpha * Math.max(0, 1 - progress * 1.7);
      }

      puff.update((mote, step) => {
        mote.x += mote.vx * step;
        mote.y += mote.vy * step;
        mote.vx *= PUFF_DRAG ** step;
        mote.vy *= PUFF_DRAG ** step;
        const remaining = mote.life / mote.maxLife;
        mote.alpha = remaining * 0.85;
      }, delta);

      return aboard;
    },

    clear(): void {
      for (const boarder of boarders) {
        boarder.life = 0;
        boarder.delay = 0;
        hide(boarder);
      }
      puff.clear();
    },
  };
};
