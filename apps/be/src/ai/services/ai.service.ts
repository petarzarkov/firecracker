import type { ZodType } from 'zod';
import type { AIProvider } from '../ai.provider.js';
import { AIProviderService } from './ai-provider.service.js';

export interface AIAnswer {
  readonly provider: AIProvider;
  readonly model: string;
  readonly text: string;
}

/**
 * What the rest of the app talks to. One method per thing worth asking for, with
 * the provider chosen by the caller or by configuration.
 */
export class AIService {
  constructor(private readonly providers: AIProviderService) {}

  get available(): boolean {
    return this.providers.anyConfigured;
  }

  async query(
    provider: AIProvider,
    model: string,
    prompt: string,
    systemPrompt?: string,
  ): Promise<AIAnswer> {
    const text = await this.providers.queryText(
      provider,
      model,
      prompt,
      systemPrompt,
    );
    return { provider, model, text };
  }

  queryStructured<T>(
    provider: AIProvider,
    model: string,
    prompt: string,
    schema: ZodType<T>,
    systemPrompt?: string,
  ): Promise<T> {
    return this.providers.queryStructured(
      provider,
      model,
      prompt,
      schema,
      systemPrompt,
    );
  }

  /**
   * A short line from whichever provider is configured, or `null`.
   *
   * `null` rather than a throw, because the one caller is cosmetic: bot chatter
   * that fails should be a lobby with fewer jokes in it, never an error path.
   */
  async line(prompt: string, systemPrompt: string): Promise<string | null> {
    /**
     * Every configured provider, not just the best one.
     *
     * One key is one free tier, and a spent tier used to mean silence until the
     * quota reset - the lobby stuck on the last lines it managed to write, which is
     * exactly what reads as a script.
     */
    for (const provider of this.providers.configured) {
      try {
        const text = await this.providers.queryText(
          provider,
          '',
          prompt,
          systemPrompt,
        );
        const trimmed = text.trim();
        if (trimmed.length > 0) return trimmed;
      } catch {
        // Logged by `queryText` already. Try the next one.
      }
    }
    return null;
  }
}
