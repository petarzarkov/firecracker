import { GoogleGenAI } from '@google/genai';
import { Logger, type OnInit } from '@dunx/core';
import type { ZodType } from 'zod';
import { AppConfigService } from '../../config/app.config.service.js';
import { BaseProviderService } from './base-provider.service.js';

/**
 * Google's free-tier requests per minute, and why this service paces itself.
 *
 * The two `-latest` aliases lead because they are the answer to the staleness this
 * file already warned about: pinned generations retire, and `models.list()` is not
 * the guard it looks like. It went on listing `gemini-2.5-flash-lite` long after
 * `generateContent` started answering **404 - no longer available to new users**, so
 * the narrowing in {@link GoogleService.onInit} kept a model that could not be
 * called, and a quota derank onto it took bot chatter offline entirely. Google moves
 * the aliases; this list stops needing to be moved with them.
 *
 * Rates are the published free-tier ceilings for the tier each alias points at, and
 * they are a floor to pace against rather than a promise - overshooting spends a 429,
 * which {@link GoogleService} handles anyway.
 */
const MODEL_RPM: Readonly<Record<string, number>> = Object.freeze({
  'gemini-pro-latest': 5,
  'gemini-2.5-pro': 5,
  'gemini-flash-latest': 10,
  'gemini-2.5-flash': 10,
  'gemini-flash-lite-latest': 15,
  'gemini-2.5-flash-lite': 15,
  'gemini-2.0-flash': 15,
  'gemini-1.5-flash': 15,
  'gemini-1.5-flash-8b': 15,
  'gemini-2.0-flash-lite': 30,
});

/**
 * The order a quota error deranks through, so it is ordered by **rising** rate limit
 * rather than by quality: a step that answered a quota error with a tighter quota
 * would be no answer at all, and `gemini-2.5-pro` at 5rpm used to sit directly under
 * the flash tiers. Nothing started above it then, so it never bit; moving the default
 * onto an alias is what would have made it bite.
 *
 * Within a tier the alias leads and the pinned generation follows it, so a key that
 * cannot see an alias still has somewhere to fall to. `onInit` drops the rest.
 */
export const MODEL_HIERARCHY = Object.keys(MODEL_RPM);

/**
 * The alias, not a pinned generation. Deranking only ever walks *down* from here, so
 * whatever this names is also the best model the service will ever use on its own.
 */
export const DEFAULT_MODEL = 'gemini-flash-latest';

/** Exported for the test that pins the derank order. See `google.service.test.ts`. */
export const modelRpm = (model: string): number | undefined => MODEL_RPM[model];

/** How long to stay on a downgraded model before trying a better one again. */
const UPGRADE_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Gemini, through the vendor's own SDK. What this adds is what a free tier makes
 * necessary: **pacing**, so a call that would breach the per-minute ceiling waits
 * rather than spending a 429; **deranking**, so a quota error drops to the next
 * model down for {@link UPGRADE_COOLDOWN_MS} instead of taking the feature offline;
 * and a live model list, because the hard-coded hierarchy goes stale.
 */
export class GoogleService extends BaseProviderService implements OnInit {
  /**
   * Lazy, and only with a key: `new GoogleGenAI({ apiKey: '' })` warns on
   * construction, so an app with no Gemini configured printed a line at every boot
   * about a provider it was not using.
   */
  #lazyClient: GoogleGenAI | null = null;
  readonly #apiKey: string;

  #model = DEFAULT_MODEL;
  #hierarchy: readonly string[] = MODEL_HIERARCHY;
  #derankedAt = 0;
  #lastRequestAt = 0;

  constructor(
    config: AppConfigService,
    private readonly logger: Logger,
  ) {
    super();
    this.#apiKey = config.get('ai').providers.gemini ?? '';
  }

  get #client(): GoogleGenAI {
    this.#lazyClient ??= new GoogleGenAI({ apiKey: this.#apiKey });
    return this.#lazyClient;
  }

  get configured(): boolean {
    return this.#apiKey.length > 0;
  }

  /**
   * Narrow the hierarchy to models this key can see. Failing is not fatal - the
   * hard-coded list is the fallback - because an unreachable provider must not stop
   * the app booting.
   */
  async onInit(): Promise<void> {
    if (!this.configured) return;
    try {
      const available = await this.listModels();
      const filtered = MODEL_HIERARCHY.filter((model) =>
        available.includes(model),
      );
      if (filtered.length > 0) this.#hierarchy = filtered;
      this.logger.info('gemini model hierarchy loaded', {
        models: this.#hierarchy,
        current: this.#model,
      });
    } catch (error) {
      this.logger.warn('could not list gemini models, using the defaults', {
        reason: (error as Error).message,
      });
    }
  }

  /** Pin the model for subsequent calls, when the caller has an opinion. */
  prefer(model: string): void {
    if (model.length > 0 && model !== this.#model) {
      this.#model = model;
      this.#derankedAt = 0;
    }
  }

  async generateText(prompt: string, systemPrompt?: string): Promise<string> {
    return this.#withDeranking(async (model) => {
      const response = await this.#client.models.generateContent({
        model,
        contents: prompt,
        ...(systemPrompt === undefined
          ? {}
          : { config: { systemInstruction: systemPrompt } }),
      });
      return response.text ?? '';
    });
  }

  async generateStructured<T>(
    prompt: string,
    schema: ZodType<T>,
    systemPrompt?: string,
  ): Promise<T> {
    const raw = await this.#withDeranking(async (model) => {
      const response = await this.#client.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: this.jsonSchema(schema),
          ...(systemPrompt === undefined
            ? {}
            : { systemInstruction: systemPrompt }),
        },
      });
      return response.text ?? '';
    });
    return this.parseJson(raw, schema);
  }

  async listModels(): Promise<readonly string[]> {
    if (!this.configured) return [];
    const page = await this.#client.models.list();
    const names: string[] = [];
    for await (const model of page) {
      // The API returns `models/gemini-2.5-flash`; the hierarchy uses the leaf.
      if (model.name !== undefined)
        names.push(model.name.replace(/^models\//, ''));
    }
    return names;
  }

  /**
   * Pace, call, and drop a model on a quota error.
   *
   * One retry at the next model down rather than a loop: if two consecutive tiers
   * are both exhausted, the honest answer is that the provider has nothing left
   * right now, and the caller (`GameBotsService`, say) treats that as "no line
   * this round" rather than as an outage.
   */
  async #withDeranking(
    call: (model: string) => Promise<string>,
  ): Promise<string> {
    if (!this.configured) throw new Error('Gemini is not configured');

    this.#considerUpgrade();
    await this.#pace();

    try {
      return await call(this.#model);
    } catch (error) {
      if (!this.isQuotaError(error)) throw error;

      const next = this.#derank();
      if (next === null) throw error;

      this.logger.warn('gemini quota reached, deranking', {
        from: this.#model,
        to: next,
      });
      this.#model = next;
      this.#derankedAt = Date.now();

      await this.#pace();
      return call(this.#model);
    }
  }

  /** Wait out this model's requests-per-minute ceiling, if we are inside it. */
  async #pace(): Promise<void> {
    const rpm = MODEL_RPM[this.#model] ?? 10;
    const minimumGap = 60_000 / rpm;
    const since = Date.now() - this.#lastRequestAt;
    if (since < minimumGap) await Bun.sleep(minimumGap - since);
    this.#lastRequestAt = Date.now();
  }

  #derank(): string | null {
    const index = this.#hierarchy.indexOf(this.#model);
    const next = this.#hierarchy[index + 1];
    return next ?? null;
  }

  /** Back to the best model once the cool-down has passed. */
  #considerUpgrade(): void {
    if (this.#derankedAt === 0) return;
    if (Date.now() - this.#derankedAt < UPGRADE_COOLDOWN_MS) return;

    const best = this.#hierarchy[0];
    if (best !== undefined && best !== this.#model) {
      this.logger.debug(
        'gemini cool-down elapsed, trying the best model again',
        {
          model: best,
        },
      );
      this.#model = best;
    }
    this.#derankedAt = 0;
  }
}
