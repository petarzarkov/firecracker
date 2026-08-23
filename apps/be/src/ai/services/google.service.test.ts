import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_MODEL,
  isRetiredModel,
  MODEL_HIERARCHY,
  modelRpm,
  narrowHierarchy,
} from './google.service.js';

describe('the gemini model hierarchy', () => {
  test('starts from a model it actually contains', () => {
    expect(MODEL_HIERARCHY).toContain(DEFAULT_MODEL);
  });

  /**
   * Deranking walks down the list on a quota error, so every step has to be *cheaper*
   * to keep - a step onto a lower requests-per-minute ceiling answers a quota problem
   * with a tighter quota. `gemini-2.5-pro` at 5rpm sitting above the flash tiers was
   * harmless only because nothing ever started above it; this is what keeps that true
   * once the default moves.
   */
  test('never deranks onto a model with a tighter rate limit', () => {
    const from = MODEL_HIERARCHY.indexOf(DEFAULT_MODEL);

    for (let at = from; at + 1 < MODEL_HIERARCHY.length; at++) {
      const here = modelRpm(MODEL_HIERARCHY[at] as string);
      const next = modelRpm(MODEL_HIERARCHY[at + 1] as string);
      expect(next).toBeGreaterThanOrEqual(here as number);
    }
  });

  /**
   * A pinned generation retires - `gemini-2.5-flash-lite` began answering 404 while
   * `models.list()` still advertised it - so within each rate tier the alias Google
   * repoints leads and the pinned generation is only the fallback behind it, for a
   * key too old to see the alias.
   */
  test.each([
    ['gemini-flash-latest', 'gemini-2.5-flash'],
    ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite'],
    ['gemini-pro-latest', 'gemini-2.5-pro'],
  ])('%s is tried before %s', (alias, pinned) => {
    expect(MODEL_HIERARCHY.indexOf(alias)).toBeGreaterThanOrEqual(0);
    expect(MODEL_HIERARCHY.indexOf(alias)).toBeLessThan(
      MODEL_HIERARCHY.indexOf(pinned),
    );
  });

  test('starts from an alias, so it does not retire under us', () => {
    expect(DEFAULT_MODEL.endsWith('-latest')).toBe(true);
  });
});

/**
 * How the aliases got deleted, and the lobby went quiet.
 *
 * `models.list()` returns pinned generations and does not advertise
 * `gemini-flash-latest`, so narrowing the hierarchy by it removed every alias - the
 * one thing in this file that exists to survive a retirement - and left the pinned
 * list with `gemini-2.5-pro` on top. That model answers 404 for this key, a 404 is
 * not a quota error, so nothing below it was ever tried: the provider was offline
 * and the bots stopped talking, on a key that worked.
 */
describe('narrowing to what a key can see', () => {
  const PINNED_ONLY = [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ];

  test('keeps the aliases even when the catalogue does not mention them', () => {
    const narrowed = narrowHierarchy(PINNED_ONLY);
    expect(narrowed).toContain('gemini-flash-latest');
    expect(narrowed).toContain(DEFAULT_MODEL);
  });

  test('still starts from the default rather than a pinned generation', () => {
    expect(narrowHierarchy(PINNED_ONLY)[0]).toBe(MODEL_HIERARCHY[0]);
    expect(narrowHierarchy(PINNED_ONLY).indexOf(DEFAULT_MODEL)).toBeLessThan(
      narrowHierarchy(PINNED_ONLY).indexOf('gemini-2.5-flash'),
    );
  });

  test('drops a pinned generation the key cannot see', () => {
    expect(narrowHierarchy(PINNED_ONLY)).not.toContain('gemini-1.5-flash-8b');
  });

  test('an empty catalogue still leaves something to call', () => {
    expect(narrowHierarchy([]).length).toBeGreaterThan(0);
    expect(narrowHierarchy([])).toContain(DEFAULT_MODEL);
  });
});

/**
 * A retired model is gone, not busy. Deranking it temporarily means
 * `#considerUpgrade` climbs back onto it when the cool-down passes - which is how
 * one dead pin produced the same 404 every ten minutes, forever.
 */
describe('telling a dead model from a busy one', () => {
  test.each([
    'This model models/gemini-2.5-pro is no longer available to new users.',
    'got status: 404 Not Found',
    'models/gemini-1.5-pro is not supported',
  ])('%s is retired', (message) => {
    expect(isRetiredModel(new Error(message))).toBe(true);
  });

  test.each([
    'You exceeded your current quota',
    '429 Too Many Requests',
    'RESOURCE_EXHAUSTED',
  ])('%s is not', (message) => {
    expect(isRetiredModel(new Error(message))).toBe(false);
  });
});
