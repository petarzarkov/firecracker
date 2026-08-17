import { z } from 'zod';

/**
 * The model providers. **All optional**: an app with none configured boots, serves
 * and simply has quieter bots - `AIService.available` is what the callers check.
 *
 * One key per provider rather than one generic key, because there is no generic
 * provider here: each service talks to the API its vendor documents.
 */
export const aiVarsSchema = z.object({
  AI_GEMINI_API_KEY: z.string().optional(),
  AI_GROQ_API_KEY: z.string().optional(),
  AI_OPENROUTER_API_KEY: z.string().optional(),

  /**
   * Higher is more varied. The default leans high because the one production
   * caller is bot chatter, where repeating the same joke every round is the
   * failure mode that reads as broken.
   */
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.8),

  /**
   * Generous, because a model is slow. `@dunx/http/client`'s default would cut a
   * normal answer off mid-sentence and then retry it.
   */
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
} as const);
