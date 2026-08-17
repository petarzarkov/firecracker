import { Controller, Get, Post, Roles, type Input } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import { UserRole } from '../users/schema/user.schema.js';
import { aiModels, aiQuery } from './dto/ai.dto.js';
import type { AIProvider } from './ai.provider.js';
import {
  AIService,
  type AIAnswer,
  type ProviderModels,
} from './services/ai.service.js';

/**
 * The AI surface, and it is **admin-only**.
 *
 * A prompt endpoint open to any signed-in player is somebody else's API key
 * spending somebody else's quota, and this app's own use of the models is the bot
 * chatter in `GameBotsService` - which calls the service directly and needs no
 * route at all. So these two exist for operating and debugging the providers, not
 * as a product feature.
 */
@ApiDoc({ tags: ['ai'], description: 'Model providers, for operators.' })
@Controller('ai')
export class AIController {
  constructor(private readonly ai: AIService) {}

  @ApiDoc({ tags: ['ai'], summary: 'Send a prompt to a named provider' })
  @Roles(UserRole.ADMIN)
  @Post('/query', aiQuery)
  query(input: Input<typeof aiQuery>): Promise<AIAnswer> {
    const { provider, model, prompt, systemPrompt } = input.body;
    return this.ai.query(provider as AIProvider, model, prompt, systemPrompt);
  }

  @ApiDoc({
    tags: ['ai'],
    summary: 'Every model each configured provider offers',
  })
  @Roles(UserRole.ADMIN)
  @Get('/models', aiModels)
  models(): Promise<readonly ProviderModels[]> {
    return this.ai.listAllModels();
  }
}
