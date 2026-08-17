import { z, type ZodType } from 'zod';

/**
 * What every provider service shares, and deliberately nothing more.
 *
 * Each provider talks to **its own API** - Google through `@google/genai`, the
 * OpenAI-compatible ones through plain REST - rather than to a generic AI SDK. So
 * what can be shared is only the bits that are genuinely identical: turning a Zod
 * schema into something a model can be shown, parsing a JSON reply that may arrive
 * fenced in markdown, and recognising a quota error.
 *
 * Retry and back-off are **not** here. They belong to the transport:
 * `@dunx/http/client`'s `HttpService` already does it for the REST providers, and
 * the Google service does its own because the SDK owns that call.
 */
export abstract class BaseProviderService {
  /** Best-effort numeric HTTP status pulled off an arbitrary thrown error. */
  protected statusOf(error: unknown): number | undefined {
    if (typeof error === 'object' && error !== null && 'status' in error) {
      const status = (error as Record<string, unknown>)['status'];
      if (status !== undefined && status !== null) return Number(status);
    }
    return undefined;
  }

  /** A hard quota or rate-limit signal, by status code or by message shape. */
  protected isQuotaError(error: unknown): boolean {
    if (this.statusOf(error) === 429) return true;
    const message = error instanceof Error ? error.message : String(error);
    return /\b429\b|resource_exhausted|quota|rate.?limit|too.?many/i.test(
      message,
    );
  }

  /**
   * Zod to JSON Schema, minus the `$schema` draft URL.
   *
   * Gemini's `responseJsonSchema` rejects unrecognised top-level keys, and for the
   * OpenAI-compatible providers the URL is noise inside a prompt.
   */
  protected jsonSchema<T>(schema: ZodType<T>): Record<string, unknown> {
    const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<
      string,
      unknown
    >;
    return rest;
  }

  /** Strip an optional ```json fence and Zod-parse what is left. */
  protected parseJson<T>(raw: string, schema: ZodType<T>): T {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    return schema.parse(JSON.parse(cleaned.trim()));
  }
}
