import { z } from 'zod';

/** The zod pieces every environment group shares, so the same input parses alike. */
export class Env {
  /**
   * A comma-separated variable as a string array, falling back to `fallback` when the
   * variable is absent or blank.
   */
  static csv(fallback: readonly string[]) {
    return z
      .string()
      .optional()
      .transform((value) =>
        value === undefined || value.trim() === ''
          ? [...fallback]
          : value
              .split(',')
              .map((part) => part.trim())
              .filter((part) => part.length > 0),
      );
  }

  /**
   * An optional string where the empty string means absent. Docker `ARG` with no
   * value becomes `''` rather than an unset variable, and so does an env file line
   * with nothing after the `=`.
   */
  static readonly blank = z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value === '' ? undefined : value,
    );
}
