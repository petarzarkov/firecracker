import { describe, expect, test } from 'bun:test';
import { autoCashOutFor } from './auto-cash-out';

describe('autoCashOutFor', () => {
  test('a manual bet never carries one, whatever the field holds', () => {
    // The regression this exists for: AUTO EXIT defaults to 1.01, and reading the
    // field without the tab would attach it to every manual bet ever placed.
    expect(autoCashOutFor('manual', '1.01')).toBeNull();
    expect(autoCashOutFor('manual', '2.5')).toBeNull();
  });

  test('an auto bet carries the target it was given', () => {
    expect(autoCashOutFor('auto', '1.01')).toBe(1.01);
    expect(autoCashOutFor('auto', '2.5')).toBe(2.5);
  });

  test('a target that is not an exit is no target', () => {
    for (const value of ['', '—', 'abc', '1', '0.5', '-3']) {
      expect(autoCashOutFor('auto', value)).toBeNull();
    }
  });
});
