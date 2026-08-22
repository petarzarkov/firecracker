import { describe, expect, test } from 'bun:test';
import { migratedByParentProcess } from './database.module.js';

/**
 * The three cases that decide whether a process applies the migrations, and the
 * middle one is the whole reason the predicate takes the path.
 */
describe('migrations in a sandboxed job child', () => {
  test('a serving process always migrates', () => {
    expect(migratedByParentProcess(undefined, './data/firecracker.db')).toBe(
      false,
    );
    expect(migratedByParentProcess(undefined, ':memory:')).toBe(false);
  });

  test('a job child over a shared file leaves it to the parent', () => {
    expect(migratedByParentProcess('true', './data/firecracker.db')).toBe(true);
  });

  test('a job child over :memory: migrates its own, empty database', () => {
    // The trap this exists for: an in-memory database belongs to the process that
    // opened it, so a child skipping here would hand a handler no tables at all -
    // however thoroughly its parent migrated.
    expect(migratedByParentProcess('true', ':memory:')).toBe(false);
  });
});
