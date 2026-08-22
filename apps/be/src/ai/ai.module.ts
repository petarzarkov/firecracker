import { Module } from '@dunx/core';
import { HttpModule } from '@dunx/http/client';
import { AppConfigService } from '../config/app.config.service.js';
import { AI_HTTP_CLIENT } from './ai.provider.js';
import { AIProviderService } from './services/ai-provider.service.js';
import { AIService } from './services/ai.service.js';
import { GoogleService } from './services/google.service.js';
import { GroqService } from './services/groq.service.js';
import { OpenRouterService } from './services/openrouter.service.js';

/**
 * The model providers. **`global: true` and decorated**, because a second scope
 * would be a second Gemini client with its own pacing state, breaching the rate
 * limit the first is respecting.
 *
 * Every provider is constructed whether or not it has a key: they report
 * `configured` rather than failing, so an app with no AI still boots.
 */
@Module({
  global: true,
  /**
   * The providers' own HTTP client. `forRootAsync` because the timeout is a config
   * value, and a model call is slow enough that the default would cut it off
   * mid-answer. `AI_HTTP_CLIENT` is the second, positional argument: the token the
   * client binds, so it does not collide with the notifications one.
   */
  imports: [
    HttpModule.forRootAsync(
      {
        useFactory: (config: AppConfigService) => ({
          timeoutMs: config.get('ai').timeoutMs,
          headers: { 'content-type': 'application/json' },
        }),
        inject: [AppConfigService] as const,
      },
      AI_HTTP_CLIENT,
    ),
  ],
  providers: [
    GoogleService,
    GroqService,
    OpenRouterService,
    AIProviderService,
    AIService,
  ],
  /**
   * `HttpModule` too, not just `AIService`: resolving the service means constructing
   * the providers behind it, which reach the named client - and dunx resolves those
   * in the scope that *asked*, so exporting the service alone failed at boot.
   */
  exports: [AIService, HttpModule],
})
export class AIModule {}
