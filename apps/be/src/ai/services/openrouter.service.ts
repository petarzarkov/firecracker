import { Logger } from '@dunx/core';
import { AppConfigService } from '../../config/app.config.service.js';
import { OpenAICompatibleService } from './openai-compatible.service.js';

/**
 * OpenRouter, over its OpenAI-compatible API.
 *
 * One key that fans out to many models - Claude, GPT, open weights - so "I want
 * provider X" is covered without a direct dependency on each vendor's SDK.
 */
export class OpenRouterService extends OpenAICompatibleService {
  constructor(config: AppConfigService, logger: Logger) {
    const ai = config.get('ai');
    super(logger, {
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: ai.providers.openrouter ?? '',
      temperature: ai.temperature,
      label: 'OpenRouter',
      defaultModel: 'meta-llama/llama-3.1-70b-instruct',
      staticModels: [
        'anthropic/claude-3.5-sonnet',
        'openai/gpt-4o',
        'meta-llama/llama-3.1-70b-instruct',
      ],
    });
  }
}
