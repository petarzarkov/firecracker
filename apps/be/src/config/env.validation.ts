import type { ConfigSource } from '@dunx/core';
import { ConfigValidationError } from './config-validation.error.js';
import { DEV_AUTH_SECRET } from './dto/auth-vars.dto.js';
import { envVarsSchema } from './env-vars.dto.js';
import type { OAuthCredentials } from './app.config.js';
import pkg from '../../package.json' with { type: 'json' };

/**
 * The environment, parsed once into the typed tree the app reads, so nothing
 * downstream touches `process.env` again. A class only so `#oauth` can be private:
 * nothing outside this file should build an `OAuthCredentials` from a pair of maybes.
 */
export class EnvConfig {
  /** Both halves or nothing: a provider with one of the two is a misconfiguration. */
  static #oauth(
    clientId: string | undefined,
    clientSecret: string | undefined,
  ): OAuthCredentials | undefined {
    return clientId === undefined || clientSecret === undefined
      ? undefined
      : { clientId, clientSecret };
  }

  /** The single validation function `ConfigModule.forRoot` takes. */
  static validate(env: ConfigSource) {
    const parsed = envVarsSchema.safeParse(env);

    if (!parsed.success) {
      const details = parsed.error.issues
        .map(
          (issue) => ` - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
        )
        .join('\n');
      throw new ConfigValidationError(
        `Configuration validation error:\n${details}`,
      );
    }

    const vars = parsed.data;

    /**
     * One origin, read twice: it is where better-auth issues cookies for *and* the
     * only absolute URL an email can link to. Computed once because a second
     * `?? http://localhost:${API_PORT}` is a second thing to keep in step.
     */
    const webUrl = vars.WEB_URL ?? `http://localhost:${vars.API_PORT}`;

    return {
      isProd: vars.APP_ENV === 'prod',
      app: {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        env: vars.APP_ENV,
        nodeEnv: vars.NODE_ENV,
        port: vars.API_PORT,
        prefix: vars.API_PREFIX,
        timezone: vars.TZ,
        webUrl,
      },
      log: {
        level: vars.LOG_LEVEL,
        maskFields: vars.LOG_MASK_FIELDS,
        filterEvents: vars.LOG_FILTER_EVENTS,
        requestBody: vars.LOG_REQUEST_BODY,
        responseBody: vars.LOG_RESPONSE_BODY,
      },
      service: {
        maxMemoryMb: vars.HEALTH_MAX_MEMORY_MB,
        maxDiskUsedFraction: vars.HEALTH_MAX_DISK_USED,
        drainDelayMs: vars.HEALTH_DRAIN_DELAY_MS,
        commitSha: vars.SERVICE_COMMIT_SHA,
        commitMessage: vars.SERVICE_COMMIT_MESSAGE,
      },
      docs: {
        path: vars.DOCS_PATH,
        jsonPath: vars.DOCS_JSON_PATH,
      },
      cors: { origin: vars.CORS_ORIGIN, trustProxy: vars.TRUST_PROXY },
      client: { dist: vars.CLIENT_DIST },
      db: {
        sqlitePath: vars.SQLITE_DB_PATH,
        busyTimeoutMs: vars.DB_BUSY_TIMEOUT_MS,
      },
      redis: {
        url: vars.REDIS_URL,
        connectTimeoutMs: vars.REDIS_CONNECT_TIMEOUT_MS,
      },
      throttle: {
        prefix: vars.THROTTLE_PREFIX,
        limit: vars.THROTTLE_LIMIT,
        windowSeconds: vars.THROTTLE_WINDOW_SECONDS,
      },
      queue: {
        consume: vars.QUEUE_CONSUME,
        prefix: vars.QUEUE_PREFIX,
        maxRetries: vars.QUEUE_MAX_RETRIES,
        retryDelayMs: vars.QUEUE_RETRY_DELAY_MS,
        concurrency: vars.QUEUE_CONCURRENCY,
        rateLimitMax: vars.QUEUE_RATE_LIMIT_MAX,
        rateLimitDurationMs: vars.QUEUE_RATE_LIMIT_DURATION_MS,
        jobTimeoutMs: vars.QUEUE_JOB_TIMEOUT_MS,
      },
      ws: { relayChannel: vars.WS_RELAY_CHANNEL },
      email: {
        apiKey: vars.RESEND_API_KEY,
        sender: vars.EMAIL_SENDER,
      },
      storage: {
        driver: vars.STORAGE_DRIVER,
        localRoot: vars.STORAGE_LOCAL_ROOT,
        prefix: vars.STORAGE_PREFIX,
        bucket: vars.S3_BUCKET,
        region: vars.S3_REGION,
        endpoint: vars.S3_ENDPOINT,
        accessKeyId: vars.S3_ACCESS_KEY_ID,
        secretAccessKey: vars.S3_SECRET_ACCESS_KEY,
        maxBytes: vars.UPLOAD_MAX_BYTES,
        allowedTypes: vars.UPLOAD_ALLOWED_TYPES,
      },
      images: {
        quality: vars.IMAGE_QUALITY,
        maxWidth: vars.IMAGE_MAX_WIDTH,
        thumbnailWidth: vars.IMAGE_THUMBNAIL_WIDTH,
      },
      slack: {
        botToken: vars.SLACK_BOT_TOKEN,
        channel: vars.SLACK_CHANNEL,
      },
      ai: {
        temperature: vars.AI_TEMPERATURE,
        timeoutMs: vars.AI_TIMEOUT_MS,
        providers: {
          gemini: vars.AI_GEMINI_API_KEY,
          groq: vars.AI_GROQ_API_KEY,
          openrouter: vars.AI_OPENROUTER_API_KEY,
        },
      },
      // Read by the engine, the bet service and the round handlers.
      game: {
        waitingPhaseMs: vars.GAME_WAITING_PHASE_MS,
        cooldownMs: vars.GAME_COOLDOWN_MS,
        tickIntervalMs: vars.GAME_TICK_INTERVAL_MS,
        multiplierDivisor: vars.GAME_MULTIPLIER_DIVISOR,
        minBetCents: vars.GAME_MIN_BET_CENTS,
        demoInitialBalanceCents: vars.GAME_DEMO_INITIAL_BALANCE_CENTS,
        cleanupIntervalMs: vars.GAME_CLEANUP_INTERVAL_MS,
        stuckRoundThresholdMs: vars.GAME_STUCK_ROUND_THRESHOLD_MS,
        cashoutGraceMs: vars.GAME_CASHOUT_GRACE_MS,
        bots: {
          enabled: vars.GAME_BOTS_ENABLED,
          minPerRound: vars.GAME_BOTS_MIN_PER_ROUND,
          maxPerRound: vars.GAME_BOTS_MAX_PER_ROUND,
          chatChance: vars.GAME_BOTS_CHAT_CHANCE,
        },
      },
      auth: {
        secret: vars.BETTER_AUTH_SECRET ?? DEV_AUTH_SECRET,
        usingDevSecret: vars.BETTER_AUTH_SECRET === undefined,
        baseUrl: webUrl,
        sessionStore: vars.AUTH_SESSION_STORE,
        trustedOrigins: vars.AUTH_TRUSTED_ORIGINS,
        sessionExpiration: vars.AUTH_SESSION_EXPIRATION,
        sessionUpdateAge: vars.AUTH_SESSION_UPDATE_AGE,
        google: EnvConfig.#oauth(
          vars.GOOGLE_OAUTH_CLIENT_ID,
          vars.GOOGLE_OAUTH_CLIENT_SECRET,
        ),
        github: EnvConfig.#oauth(
          vars.GITHUB_OAUTH_CLIENT_ID,
          vars.GITHUB_OAUTH_CLIENT_SECRET,
        ),
        linkedin: EnvConfig.#oauth(
          vars.LINKEDIN_OAUTH_CLIENT_ID,
          vars.LINKEDIN_OAUTH_CLIENT_SECRET,
        ),
        seedAdmin: {
          email: vars.SEED_ADMIN_EMAIL,
          password: vars.SEED_ADMIN_PASSWORD,
        },
      },
    };
  }
}

/**
 * Deep-readonly so the derived type keeps the guarantee the hand-written interface
 * gave, without restating a single field. Inference alone would widen every
 * property to mutable.
 */
type DeepReadonly<T> = T extends readonly (infer E)[]
  ? readonly DeepReadonly<E>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/**
 * `ReturnType`, not a declaration: the validator already describes every field, and
 * a second description is one that drifts.
 */
export type AppConfig = DeepReadonly<ReturnType<typeof EnvConfig.validate>>;
