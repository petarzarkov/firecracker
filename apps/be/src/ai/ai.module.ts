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
 * The providers' own HTTP client. `forRootAsync` because the timeout is a config
 * value, and a model call is slow enough that the default would cut it off
 * mid-answer.
 *
 * Hoisted to a `const` so the same reference is both imported and re-exported. A
 * scope is keyed on the module reference, so calling `forRootAsync` twice would name
 * a module that is not in the graph.
 */
const http = HttpModule.forRootAsync(
  {
    useFactory: (config: AppConfigService) => ({
      timeoutMs: config.get('ai').timeoutMs,
      headers: { 'content-type': 'application/json' },
    }),
    inject: [AppConfigService] as const,
  },
  AI_HTTP_CLIENT,
);

/**
 * The model providers.
 *
 * **`global: true`**, because the game's bots reach `AIService` and this module
 * has no other consumer worth making import it - and because a second
 * `forRoot()` would have built a second Gemini client with its own pacing state,
 * which would then breach the rate limit the first one is carefully respecting.
 * Decorated for exactly that reason: a class is one reference however many modules
 * name it.
 *
 * Every provider is constructed whether or not it has a key. They report
 * `configured` instead of failing, so an app with no AI configured still boots,
 * still serves, and simply has quieter bots.
 *
 * No controller and therefore no options: this module is reached only from
 * `GameBotsService` and `AvatarsService`, both of which inject it.
 */
@Module({
  global: true,
  imports: [http],
  providers: [
    GoogleService,
    GroqService,
    OpenRouterService,
    AIProviderService,
    AIService,
  ],
  /**
   * `http` as well as `AIService`, and the reference rather than a token list.
   *
   * This module is `global: true`, so a consumer resolves `AIService` from
   * anywhere - and resolving it means constructing the providers behind it,
   * which reach the named client. Exporting only `AIService` left that
   * invisible from the requesting scope and boot failed naming it.
   */
  exports: [AIService, http],
})
export class AIModule {}
