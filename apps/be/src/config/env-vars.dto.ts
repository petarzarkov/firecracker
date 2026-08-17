import { z } from 'zod';
import { aiVarsSchema } from './dto/ai-vars.dto.js';
import { authVarsSchema } from './dto/auth-vars.dto.js';
import { dbVarsSchema } from './dto/db-vars.dto.js';
import { gameVarsSchema } from './dto/game-vars.dto.js';
import { notificationVarsSchema } from './dto/notification-vars.dto.js';
import { redisVarsSchema } from './dto/redis-vars.dto.js';
import { serviceVarsSchema } from './dto/service-vars.dto.js';
import { StorageDriver, storageVarsSchema } from './dto/storage-vars.dto.js';

/**
 * One flat schema over the raw environment, composed from the per-concern
 * schemas. `superRefine` carries the cross-field rules that a single field's
 * validator cannot see.
 */
export const envVarsSchema = z
  .object({
    ...serviceVarsSchema.shape,
    ...dbVarsSchema.shape,
    ...redisVarsSchema.shape,
    ...storageVarsSchema.shape,
    ...authVarsSchema.shape,
    ...notificationVarsSchema.shape,
    ...gameVarsSchema.shape,
    ...aiVarsSchema.shape,
  })
  .superRefine((vars, ctx) => {
    if (
      vars.STORAGE_DRIVER === StorageDriver.S3 &&
      vars.S3_BUCKET === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET is required when STORAGE_DRIVER=s3',
      });
    }

    if (vars.APP_ENV === 'prod' && vars.BETTER_AUTH_SECRET === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message:
          'BETTER_AUTH_SECRET is required when APP_ENV=prod: the development fallback is a constant in the repository and would let anyone mint a session',
      });
    }

    if (vars.AUTH_SESSION_STORE === 'redis' && vars.REDIS_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required when AUTH_SESSION_STORE=redis',
      });
    }

    if (vars.AUTH_SESSION_UPDATE_AGE > vars.AUTH_SESSION_EXPIRATION) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_SESSION_UPDATE_AGE'],
        message:
          'AUTH_SESSION_UPDATE_AGE must not exceed AUTH_SESSION_EXPIRATION',
      });
    }

    /**
     * The engine ticks on a timer and the betting window is a delayed job. A
     * window shorter than a tick means a round whose WAITING phase can be missed
     * entirely by a client, which reads as a frozen game rather than a fast one.
     */
    if (vars.GAME_WAITING_PHASE_MS <= vars.GAME_TICK_INTERVAL_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['GAME_WAITING_PHASE_MS'],
        message:
          'GAME_WAITING_PHASE_MS must be longer than GAME_TICK_INTERVAL_MS',
      });
    }

    if (vars.GAME_BOTS_MAX_PER_ROUND < vars.GAME_BOTS_MIN_PER_ROUND) {
      ctx.addIssue({
        code: 'custom',
        path: ['GAME_BOTS_MAX_PER_ROUND'],
        message:
          'GAME_BOTS_MAX_PER_ROUND must be at least GAME_BOTS_MIN_PER_ROUND',
      });
    }

    /**
     * The cleanup job fails a round it considers stuck and refunds its bets. If
     * that threshold is inside the length of a normal round, it refunds live bets
     * out from under the players holding them.
     */
    if (
      vars.GAME_STUCK_ROUND_THRESHOLD_MS <=
      vars.GAME_WAITING_PHASE_MS + vars.GAME_COOLDOWN_MS
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['GAME_STUCK_ROUND_THRESHOLD_MS'],
        message:
          'GAME_STUCK_ROUND_THRESHOLD_MS must exceed GAME_WAITING_PHASE_MS + GAME_COOLDOWN_MS, or the cleanup job will refund rounds that are merely in progress',
      });
    }
  });

export type EnvVars = z.infer<typeof envVarsSchema>;
