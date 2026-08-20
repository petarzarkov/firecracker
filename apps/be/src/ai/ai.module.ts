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
   * `HttpModule` as well as `AIService`, and the module rather than a token list.
   *
   * This module is `global: true`, so a consumer resolves `AIService` from
   * anywhere - and resolving it means constructing the providers behind it,
   * which reach the named client. Exporting only `AIService` left that
   * invisible from the requesting scope and boot failed naming it.
   *
   * Naming the class works because dunx 2.2.0 resolves such an entry to the
   * configuration of that class this module imports - the one above, with its
   * `AI_HTTP_CLIENT` token. It is what retired the hoisted `const`.
   */
  exports: [AIService, HttpModule],
})
export class AIModule {}
