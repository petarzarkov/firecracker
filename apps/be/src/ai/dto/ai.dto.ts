import type { RouteSchemas } from '@dunx/http';
import { z } from 'zod';
import { AI_PROVIDERS } from '../ai.provider.js';

const PROVIDERS = AI_PROVIDERS as unknown as [string, ...string[]];

export const AIQuery = z
  .object({
    provider: z.enum(PROVIDERS),
    /** Empty means "whatever this provider defaults to". */
    model: z.string().max(200).default(''),
    prompt: z.string().min(1).max(8000),
    systemPrompt: z.string().max(4000).optional(),
  })
  .meta({ id: 'AIQuery', title: 'A prompt for a named provider' });

export const AIAnswer = z
  .object({
    provider: z.string(),
    model: z.string(),
    text: z.string(),
  })
  .meta({ id: 'AIAnswer', title: 'What the model replied' });

export const AIModels = z
  .object({
    provider: z.string(),
    models: z.array(z.string()),
  })
  .meta({ id: 'AIModels', title: 'Models a provider offers' });

export const aiQuery = { body: AIQuery } as const satisfies RouteSchemas;
export const aiModels = {} as const satisfies RouteSchemas;
