import { describe, expect, test } from 'bun:test';
import { Texture } from 'pixi.js';
import { createMotePool, type Mote } from './pool.js';

/**
 * The pool is the part of the stage that can be checked without a GPU: PIXI's
 * scene objects construct fine headlessly, it is only the renderer that needs
 * hardware. What is tested here is the recycling - the bookkeeping that replaced
 * the old `push`/`splice` arrays, and the only place in the port where a slot can
 * quietly leak or be handed out twice.
 */

const pool = (capacity: number) => createMotePool(capacity, Texture.EMPTY);

const seed = (
  over: Partial<Parameters<ReturnType<typeof pool>['spawn']>[0]> = {},
) => ({
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  life: 10,
  size: 1,
  tint: 0xffffff,
  ...over,
});

/** Steps `frames` times with a no-op, letting motes age out. */
const age = (p: ReturnType<typeof pool>, frames: number) => {
  for (let i = 0; i < frames; i++) p.update(() => {});
};

describe('the mote pool', () => {
  test('allocates its particles up front and never after', () => {
    const p = pool(8);
    expect(p.view.particleChildren.length).toBe(8);
    for (let i = 0; i < 50; i++) p.spawn(seed());
    expect(p.view.particleChildren.length).toBe(8);
  });

  test('a spawned mote is alive, and a dead one frees its slot', () => {
    const p = pool(4);
    p.spawn(seed({ life: 3 }));
    expect(p.alive).toBe(1);
    age(p, 4);
    expect(p.alive).toBe(0);
  });

  test('slots are reused rather than exhausted', () => {
    const p = pool(4);
    for (let round = 0; round < 20; round++) {
      p.spawn(seed({ life: 2 }));
      age(p, 3);
    }
    expect(p.alive).toBe(0);
    expect(p.view.particleChildren.length).toBe(4);
  });

  /**
   * A full pool overwrites rather than dropping. Dropping would thin a burst out
   * at exactly the moment it should be densest.
   */
  test('a full pool still accepts spawns, and stays full', () => {
    const p = pool(4);
    for (let i = 0; i < 12; i++) p.spawn(seed({ life: 100 }));
    expect(p.alive).toBe(4);
    expect(p.view.particleChildren.length).toBe(4);
  });

  test('the live count never goes negative or exceeds capacity', () => {
    const p = pool(6);
    for (let frame = 0; frame < 200; frame++) {
      if (frame % 3 === 0) p.spawn(seed({ life: 1 + (frame % 7) }));
      p.update(() => {});
      expect(p.alive).toBeGreaterThanOrEqual(0);
      expect(p.alive).toBeLessThanOrEqual(6);
    }
  });

  test('a step can kill a mote early by returning false', () => {
    const p = pool(4);
    p.spawn(seed({ life: 100 }));
    p.update(() => false);
    expect(p.alive).toBe(0);
  });

  test('the step only sees live motes', () => {
    const p = pool(5);
    p.spawn(seed({ life: 4 }));
    p.spawn(seed({ life: 4 }));
    let seen = 0;
    p.update(() => {
      seen += 1;
    });
    expect(seen).toBe(2);
  });

  test('a spawn resets every field of the slot it reuses', () => {
    const p = pool(1);
    p.spawn(seed({ x: 99, vx: 5, life: 1, size: 9, tint: 0x00ff00 }));
    age(p, 2);
    p.spawn(seed({ x: 1, vx: 0, life: 6, size: 2, tint: 0xff0000 }));

    let captured: Mote | null = null;
    p.update((mote) => {
      captured = mote;
    });
    // Read through a local so the assertions do not fight the closure's type.
    const mote = captured as Mote | null;
    expect(mote?.x).toBe(1);
    expect(mote?.vx).toBe(0);
    expect(mote?.size).toBe(2);
    expect(mote?.tint).toBe(0xff0000);
    expect(mote?.alpha).toBe(1);
  });

  test('clear kills everything at once', () => {
    const p = pool(10);
    for (let i = 0; i < 10; i++) p.spawn(seed({ life: 100 }));
    expect(p.alive).toBe(10);
    p.clear();
    expect(p.alive).toBe(0);
    let seen = 0;
    p.update(() => {
      seen += 1;
    });
    expect(seen).toBe(0);
  });

  test('a zero-capacity pool is inert rather than a crash', () => {
    const p = pool(0);
    p.spawn(seed());
    p.update(() => {});
    p.clear();
    expect(p.alive).toBe(0);
  });

  test('`maxLife` is at least one, so a fade never divides by zero', () => {
    const p = pool(2);
    p.spawn(seed({ life: 0 }));
    p.spawn(seed({ life: 5 }));
    p.update((mote) => {
      expect(Number.isFinite(mote.life / mote.maxLife)).toBe(true);
    });
  });
});
