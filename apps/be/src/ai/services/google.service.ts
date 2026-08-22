import { GoogleGenAI } from '@google/genai';
import { Logger, type OnInit } from '@dunx/core';
import type { ZodType } from 'zod';
import { AppConfigService } from '../../config/app.config.service.js';
import { BaseProviderService } from './base-provider.service.js';

/** Google's free-tier requests per minute, and why this service paces itself. */
const MODEL_RPM: Readonly<Record<string, number>> = Object.freeze({
  'gemini-2.5-pro': 5,
  'gemini-2.5-flash': 10,
  'gemini-2.5-flash-lite': 15,
  'gemini-2.0-flash': 15,
  'gemini-2.0-flash-lite': 30,
  'gemini-1.5-flash': 15,
  'gemini-1.5-flash-8b': 15,
});

/** Best to worst. Also the order this deranks through on a quota error. */
const MODEL_HIERARCHY = Object.keys(MODEL_RPM);

const DEFAULT_MODEL = 'gemini-2.5-flash';

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
