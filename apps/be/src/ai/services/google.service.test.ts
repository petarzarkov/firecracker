import { describe, expect, test } from 'bun:test';
import { DEFAULT_MODEL, MODEL_HIERARCHY, modelRpm } from './google.service.js';

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
