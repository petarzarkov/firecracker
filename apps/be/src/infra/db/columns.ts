import { integer, text } from 'drizzle-orm/sqlite-core';

/**
 * The column shapes every table shares.
 *
 * Names are spelled out rather than derived: drizzle's `casing: 'snake_case'` is set on
 * the `drizzle()` call and `SqliteOptions` forwards only `schema`, so the convention is
 * unreachable from inside the container. Explicit names keep the runtime handle and the
 * drizzle-kit output agreeing.
 */
export class Columns {
  static uuidPk() {
    return text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID());
  }

  static timestampMs(name: string) {
    return integer(name, { mode: 'timestamp_ms' });
  }

  static createdAt() {
    return Columns.timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date());
  }

  static updatedAt() {
    return Columns.timestampMs('updated_at')
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date());
  }
}
