import type { RouteSchemas } from '@dunx/http';
import { BET_STATUSES, ROUND_STATUSES } from '@firecracker/contracts';
import { z } from 'zod';
import { pageOptionsSchema } from '../../core/pagination.dto.js';

/**
 * A round as a client sees it.
 *
 * `crashPoint` and `seed` are **optional on purpose**: they are absent until the
 * round has crashed. Publishing either early would hand out the outcome while
 * bets are still open, so the mapper omits them rather than the route hiding them.
 * `seedHash` is present from the start - that is the commitment.
 */
export const GameRound = z
  .object({
    id: z.uuid(),
    status: z.enum(ROUND_STATUSES),
    seedHash: z.string(),
    clientSeed: z.string().nullable(),
    nonce: z.number().int(),
    crashPoint: z.number().optional(),
    seed: z.string().optional(),
    rngAlgorithm: z.string(),
    waitingEndsAt: z.iso.datetime().nullable(),
    startedAt: z.iso.datetime().nullable(),
    crashedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'GameRound', title: 'One round of the crash game' });
export type GameRound = z.infer<typeof GameRound>;

export const CurrentRound = GameRound.extend({
  /** Only while RUNNING: where the curve is right now. */
  multiplier: z.number().optional(),
  elapsed: z.number().int().optional(),
}).meta({ id: 'CurrentRound', title: 'The round in progress' });
export type CurrentRound = z.infer<typeof CurrentRound>;

/**
 * A stake as its owner sees it.
 *
 * `crashPoint` is the round's, not the bet's, and it is optional for the same
 * reason it is optional on `GameRound`: it appears once that round has crashed and
 * not a moment earlier. The history panel renders it on every row that is not a
 * win, so a missing one showed as `x0.00x` for months - see `listByUser`.
 */
export const GameBet = z
  .object({
    id: z.uuid(),
    roundId: z.uuid(),
    userId: z.uuid(),
    betAmountCents: z.number().int(),
    status: z.enum(BET_STATUSES),
    cashedOutAt: z.number().nullable(),
    payoutCents: z.number().int().nullable(),
    crashPoint: z.number().optional(),
    isDemo: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'GameBet', title: 'A stake in one round' });
export type GameBet = z.infer<typeof GameBet>;

/**
 * Everything needed to check a round independently.
 *
 * `rngSeed` is the exact string handed to the generator, spelled out rather than
 * left for the caller to reassemble - the format is part of the fairness contract,
 * and a verifier that builds it slightly differently gets a different number and
 * concludes we cheated.
 */
export const RoundVerification = z
  .object({
    roundId: z.uuid(),
    serverSeed: z.string(),
    serverSeedHash: z.string(),
    clientSeed: z.string(),
    nonce: z.number().int(),
    algorithm: z.string(),
    rngSeed: z.string(),
    crashPoint: z.number(),
    howToVerify: z.array(z.string()),
  })
  .meta({
    id: 'RoundVerification',
    title: 'Provably-fair inputs for a crashed round',
  });
/**
 * The *response*. `GameRoundService` has an interface of the same name for the
 * proof it reads out of the round row, which carries `crashPointX100` and no
 * instructions - this is that, converted at the edge and documented.
 */
export type RoundVerification = z.infer<typeof RoundVerification>;

const RoundIdParams = z.object({ roundId: z.uuid() });

export const gameState = {} as const satisfies RouteSchemas;
export const listRounds = {
  query: pageOptionsSchema,
} as const satisfies RouteSchemas;
export const oneRound = {
  params: RoundIdParams,
} as const satisfies RouteSchemas;
export const verifyRound = {
  params: RoundIdParams,
} as const satisfies RouteSchemas;
export const listMyBets = {
  query: pageOptionsSchema,
} as const satisfies RouteSchemas;
