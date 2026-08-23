import { Logger } from '@dunx/core';
import { HttpError, HttpStatusCode } from '@dunx/http';
import type { ZodType } from 'zod';
import { AIProvider } from '../ai.provider.js';
import { GoogleService } from './google.service.js';
import { GroqService } from './groq.service.js';
import type { OpenAICompatibleService } from './openai-compatible.service.js';
import { OpenRouterService } from './openrouter.service.js';

/**
 * Routes a provider name to the service that speaks to it, and nothing else.
 *
 * There is no shared AI SDK behind this - Google goes through `@google/genai` and
 * the OpenAI-compatible ones through REST - so this is dispatch rather than an
 * abstraction layer. That is the point: adding a provider means adding a service
 * and a case, not teaching a generic client a new dialect.
 */
export class AIProviderService {
  constructor(
    private readonly google: GoogleService,
    private readonly groq: GroqService,
    private readonly openRouter: OpenRouterService,
    private readonly logger: Logger,
  ) {}

  /** Whether anything at all is configured, which decides if the feature exists. */
  get anyConfigured(): boolean {
    return (
      this.google.configured ||
      this.groq.configured ||
      this.openRouter.configured
    );
  }

  /** The first configured provider, for callers with no preference. */
  get preferred(): AIProvider | null {
    return this.configured[0] ?? null;
  }

  /**
   * Every provider with credentials, best first.
   *
   * A list rather than a single choice, because one provider is one free tier: a
   * Gemini key allows twenty `generate_content` calls a day, which a lobby betting
   * every twenty seconds spends inside a quarter of an hour. After that
   * `preferred` alone answered nothing for the rest of the day and the chat froze
   * on whatever was in the scrollback - which is what a visitor then reads as
   * canned, because by then it is.
   */
  get configured(): readonly AIProvider[] {
    return [
      ...(this.groq.configured ? [AIProvider.GROQ] : []),
      ...(this.google.configured ? [AIProvider.GOOGLE] : []),
      ...(this.openRouter.configured ? [AIProvider.OPENROUTER] : []),
    ];
  }

  async queryText(
    provider: AIProvider,
    model: string,
    prompt: string,
    systemPrompt?: string,
  ): Promise<string> {
    try {
      if (provider === AIProvider.GOOGLE) {
        this.google.prefer(model);
        return await this.google.generateText(prompt, systemPrompt);
      }
      return await this.#openAICompatible(provider).generateText(
        model,
        prompt,
        systemPrompt,
      );
    } catch (error) {
      this.#log('query', provider, model, error);
      throw error;
    }
  }

  async queryStructured<T>(
    provider: AIProvider,
    model: string,
    prompt: string,
    schema: ZodType<T>,
    systemPrompt?: string,
  ): Promise<T> {
    try {
      if (provider === AIProvider.GOOGLE) {
        this.google.prefer(model);
        return await this.google.generateStructured(
          prompt,
          schema,
          systemPrompt,
        );
      }
      return await this.#openAICompatible(provider).generateStructured(
        model,
        prompt,
        schema,
        systemPrompt,
      );
    } catch (error) {
      this.#log('structured query', provider, model, error);
      throw error;
    }
  }

  #openAICompatible(provider: AIProvider): OpenAICompatibleService {
    switch (provider) {
      case AIProvider.GROQ:
        return this.groq;
      case AIProvider.OPENROUTER:
        return this.openRouter;
      default:
        throw new HttpError(
          HttpStatusCode.BAD_REQUEST,
          `${provider} is not a configured provider`,
        );
    }
  }

  #log(
    operation: string,
    provider: AIProvider,
    model: string | undefined,
    error: unknown,
  ): void {
    this.logger.error(`${operation} failed on ${provider}`, {
      provider,
      model,
      reason: (error as Error).message,
    });
  }
}
