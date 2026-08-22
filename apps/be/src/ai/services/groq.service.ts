import { Logger } from '@dunx/core';
import { AppConfigService } from '../../config/app.config.service.js';
import { OpenAICompatibleService } from './openai-compatible.service.js';

/**
 * Groq, over its OpenAI-compatible API.
 *
 * Fast and generous on the free tier, with a quota pool separate from Gemini's -
 * which is what makes it the sensible fallback when Google is rate-limited.
 */
export class GroqService extends OpenAICompatibleService {
  constructor(config: AppConfigService, logger: Logger) {
    const ai = config.get('ai');
    super(logger, {
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: ai.providers.groq ?? '',
      temperature: ai.temperature,
      label: 'Groq',
      defaultModel: 'llama-3.3-70b-versatile',
    });
  }
}
