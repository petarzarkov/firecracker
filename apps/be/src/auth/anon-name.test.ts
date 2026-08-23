import { describe, expect, test } from 'bun:test';
import { anonymousName } from './anon-name.js';

describe('anonymousName', () => {
  test('is an adjective, a noun and three digits', () => {
    for (let i = 0; i < 50; i++) {
      expect(anonymousName()).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{3}$/);
    }
  });

  /**
   * The whole point of the option. `Anonymous` is what better-auth names every demo
   * player without it, and a lobby of them is indistinguishable.
   */
  test('is never the plugin default', () => {
    for (let i = 0; i < 50; i++) {
      expect(anonymousName()).not.toBe('Anonymous');
    }
  });

  test('two players almost never share a name', () => {
    const names = new Set(Array.from({ length: 200 }, () => anonymousName()));
    // 30 x 30 x 900 pairs: a duplicate in 200 draws is possible, a handful is not.
    expect(names.size).toBeGreaterThan(195);
  });
});
