import { Assets, Container, Sprite, Text, type Texture } from 'pixi.js';
import * as palette from '../palette.js';
import type { StageCashOut } from '../types.js';

/**
 * Everyone who got out, drifting down under a canopy with what they won.
 *
 * A cash-out used to be a row changing colour in a side panel. This is the same
 * information where the player is already looking - the difference between a
 * lobby that reports outcomes and one where you can see other people escaping
 * while you are still deciding.
 *
 * Pooled like everything else in the scene: a fixed set of canopies is built up
 * front and reused, because a lobby of forty can settle inside one frame and
 * allocating sprites and text objects at that moment is the worst time to do it.
 */

/** Canopies in the air at once. Beyond this the oldest is recycled. */
const CAPACITY = 14;

const FALL_SECONDS = 4.2;
const FRAMES = FALL_SECONDS * 60;

/** Downward speed, in plot pixels per 60fps frame. */
const SINK = 1.35;

/** How far the canopy swings, and how fast. */
const SWAY_PIXELS = 26;
const SWAY_RATE = 0.028;

/**
 * Drift, leftward.
 *
 * Not symmetrical, and not incidental: the rocket lives at the plot's right
 * edge, so jumpers leave from there and anything that keeps them near it gets
 * clamped back against the same margin - two cash-outs in the same second
 * stacked their labels on top of each other's canopies. Sending them away from
 * the rocket is what makes a crowd legible.
 */
const DRIFT = [-1.15, -0.2] as const;

/** How far behind the rocket they can appear. */
const SPAWN_TRAIL = 170;

const CANOPY_WIDTH = 74;

/** The label sits above the canopy, in the same mono the lobby uses. */
const LABEL_STYLE = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: 13,
  fontWeight: '700' as const,
  fill: palette.CASHOUT_TEXT,
  align: 'center' as const,
};

interface Jumper {
  x: number;
  y: number;
  vx: number;
  /** Frames left. `0` means the slot is free. */
  life: number;
  /** Phase of the sway, so two canopies never swing in lockstep. */
  swayAt: number;
  sprite: Sprite | null;
  label: Text;
}

export interface Parachutes {
  readonly view: Container;
  /** Put someone in the air at `(x, y)`. */
  drop(cashOut: StageCashOut, x: number, y: number): void;
  advance(delta: number, width: number, height: number): void;
  clear(): void;
}

const money = (cents: number): string => `+$${(cents / 100).toFixed(2)}`;

export const createParachutes = async (url?: string): Promise<Parachutes> => {
  const view = new Container();

  let texture: Texture | null = null;
  if (url !== undefined) {
    texture = await Assets.load<Texture>(url).catch(() => null);
  }
  const aspect =
    texture === null || texture.width === 0
      ? 1
      : texture.height / texture.width;

  const jumpers: Jumper[] = [];
  for (let i = 0; i < CAPACITY; i++) {
    const sprite = texture === null ? null : new Sprite(texture);
    if (sprite !== null) {
      sprite.anchor.set(0.5, 0);
      sprite.width = CANOPY_WIDTH;
      sprite.height = CANOPY_WIDTH * aspect;
      sprite.visible = false;
      view.addChild(sprite);
    }

    const label = new Text({ text: '', style: LABEL_STYLE });
    label.anchor.set(0.5, 1);
    label.visible = false;
    view.addChild(label);

    jumpers.push({
      x: 0,
      y: 0,
      vx: 0,
      life: 0,
      swayAt: 0,
      sprite,
      label,
    });
  }

  let cursor = 0;

  /** A free slot, or the oldest occupied one when the sky is full. */
  const claim = (): Jumper => {
    for (let i = 0; i < CAPACITY; i++) {
      const jumper = jumpers[(cursor + i) % CAPACITY] as Jumper;
      if (jumper.life <= 0) {
        cursor = (cursor + i + 1) % CAPACITY;
        return jumper;
      }
    }
    const jumper = jumpers[cursor] as Jumper;
    cursor = (cursor + 1) % CAPACITY;
    return jumper;
  };

  return {
    view,

    drop(cashOut, x, y): void {
      const jumper = claim();
      // Spread back along the rocket's wake, so several cash-outs in the same
      // instant - which is what a round hitting a popular auto-exit looks like -
      // do not stack into one silhouette.
      jumper.x = x - Math.random() * SPAWN_TRAIL;
      jumper.y = y;
      jumper.vx = DRIFT[0] + Math.random() * (DRIFT[1] - DRIFT[0]);
      jumper.life = FRAMES;
      jumper.swayAt = Math.random() * Math.PI * 2;

      jumper.label.text = `${cashOut.name}\n${cashOut.multiplier.toFixed(2)}x  ${money(cashOut.payoutCents)}`;
      jumper.label.visible = true;
      if (jumper.sprite !== null) jumper.sprite.visible = true;
    },

    advance(delta, width, height): void {
      for (const jumper of jumpers) {
        if (jumper.life <= 0) continue;

        jumper.life -= delta;
        if (jumper.life <= 0) {
          jumper.label.visible = false;
          if (jumper.sprite !== null) jumper.sprite.visible = false;
          continue;
        }

        jumper.swayAt += SWAY_RATE * delta;
        jumper.y += SINK * delta;
        jumper.x += jumper.vx * delta;

        const swing = Math.sin(jumper.swayAt) * SWAY_PIXELS;
        /**
         * Kept inside the canvas.
         *
         * Jumpers leave from the rocket, which lives at the plot's right edge,
         * so without this the canopy and - worse - the label it carries hang off
         * the side. A cash-out whose winnings read `+$55.0` is the one thing
         * here that must not be cut in half.
         */
        const margin = Math.max(CANOPY_WIDTH, jumper.label.width) / 2 + 4;
        const drawnX = Math.max(
          margin,
          Math.min(width - margin, jumper.x + swing),
        );

        // Faded in over the first moments and out over the last, so nobody pops
        // into or out of existence.
        const age = 1 - jumper.life / FRAMES;
        const fade = Math.min(1, age * 8, (jumper.life / FRAMES) * 4);
        // ...and out of the bottom of the plot as well, whatever their age.
        const room = Math.max(0, Math.min(1, (height - jumper.y) / 90));
        const alpha = fade * room;

        if (jumper.sprite !== null) {
          jumper.sprite.x = drawnX;
          jumper.sprite.y = jumper.y;
          // The canopy leans into its own swing, which is what sells it as
          // hanging rather than sliding.
          jumper.sprite.rotation = Math.cos(jumper.swayAt) * 0.16;
          jumper.sprite.alpha = alpha;
        }
        jumper.label.x = drawnX;
        jumper.label.y = jumper.y - 8;
        jumper.label.alpha = alpha;
      }
    },

    clear(): void {
      for (const jumper of jumpers) {
        jumper.life = 0;
        jumper.label.visible = false;
        if (jumper.sprite !== null) jumper.sprite.visible = false;
      }
    },
  };
};
