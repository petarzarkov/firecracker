import { inject, Logger } from '@dunx/core';
import { httpClient } from '@dunx/http/client';
import type { ZodType } from 'zod';
import { AI_HTTP_CLIENT } from '../ai.provider.js';
import { BaseProviderService } from './base-provider.service.js';

interface ChatMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

interface ChatCompletionResponse {
  readonly choices?: { message?: { content?: string } }[];
}

export interface OpenAICompatibleOptions {
  /** OpenAI-compatible API root, e.g. `https://api.groq.com/openai/v1`. */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly temperature: number;
  /** Used in log lines and error messages. */
  readonly label: string;
  /** The model used when the caller does not pin one. */
  readonly defaultModel: string;
}

/**
 * Any provider exposing an OpenAI-compatible `/chat/completions`. Plain REST through
 * `@dunx/http/client`, so no SDK and no new dependency: one HTTP shape covers every
 * provider that speaks it.
 *
 * Structured output uses `response_format: { type: 'json_object' }` rather than the
 * strict `json_schema` mode most Groq models reject. `json_object` promises valid
 * JSON and nothing about field names, so the schema goes in the prompt and the reply
 * is Zod-parsed: the validation is the guarantee, the mode is a hint.
 */
export abstract class OpenAICompatibleService extends BaseProviderService {
  /**
   * The **named** client, via `inject()` in a field initialiser: a named client is
   * bound to a `Token`, which has no type name for `@dunx/transform` to record, so
   * it cannot be a constructor parameter. Named rather than plain because
   * `AIModule` is `global: true` and exports it: an unnamed binding would make a
   * model call's 30-second budget the default every other `HttpService` inherits.
   */
  protected readonly http = inject(httpClient(AI_HTTP_CLIENT));

  protected constructor(
    protected readonly logger: Logger,
    protected readonly options: OpenAICompatibleOptions,
  ) {
    super();
  }

  /** A provider with no key is *skipped*, never an error. */
  get configured(): boolean {
    return this.options.apiKey.length > 0;
  }

  generateText(
    model: string,
    prompt: string,
    systemPrompt?: string,
  ): Promise<string> {
    return this.#chat(model, this.#messages(prompt, systemPrompt), false);
  }

  async generateStructured<T>(
    model: string,
    prompt: string,
    schema: ZodType<T>,
    systemPrompt?: string,
  ): Promise<T> {
    const shape = this.#jsonInstruction(schema);
    const system =
      systemPrompt === undefined ? shape : `${systemPrompt}\n\n${shape}`;
    const raw = await this.#chat(model, this.#messages(prompt, system), true);
    return this.parseJson(raw, schema);
  }

  /**
   * `json_object` mode requires the literal word "json" somewhere in the prompt,
   * which is why the wording is what it is rather than something tidier.
   */
  #jsonInstruction<T>(schema: ZodType<T>): string {
    return (
      'Respond with a single JSON object - no markdown, no prose - that matches ' +
      `this JSON schema exactly:\n${JSON.stringify(this.jsonSchema(schema))}`
    );
  }

  #messages(prompt: string, systemPrompt?: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    if (systemPrompt !== undefined) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });
    return messages;
  }

  #authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.options.apiKey}` };
  }

  async #chat(
    model: string,
    messages: readonly ChatMessage[],
    json: boolean,
  ): Promise<string> {
    if (!this.configured) {
      throw new Error(`${this.options.label} is not configured`);
    }

    const data = await this.http.post<unknown, ChatCompletionResponse>(
      `${this.options.baseUrl}/chat/completions`,
      {
        model: model.length > 0 ? model : this.options.defaultModel,
        temperature: this.options.temperature,
        messages,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      },
      { headers: this.#authHeaders() },
    );

    return data?.choices?.[0]?.message?.content ?? '';
  }
}
