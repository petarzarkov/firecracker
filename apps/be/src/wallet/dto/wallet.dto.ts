import type { RouteSchemas } from '@dunx/http';
import { TRANSACTION_TYPES } from '@firecracker/contracts';
import { z } from 'zod';
import { pageOptionsSchema } from '../../core/pagination.dto.js';

export const Wallet = z
  .object({
    id: z.uuid(),
    balanceCents: z.number().int(),
    isDemo: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Wallet', description: 'A balance' });
export type Wallet = z.infer<typeof Wallet>;

export const WalletTransaction = z
  .object({
    id: z.uuid(),
    type: z.enum(TRANSACTION_TYPES),
    amountCents: z.number().int(),
    balanceAfterCents: z.number().int(),
    gameBetId: z.uuid().nullable(),
    description: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'WalletTransaction', description: 'One movement on a balance' });
export type WalletTransaction = z.infer<typeof WalletTransaction>;

/**
 * Which of the caller's two wallets a route is about.
 *
 * `stringbool` because it arrives as a query string, and defaulted to the real
 * one: a route that silently answered about the demo balance when the parameter
 * was missing would be the more dangerous default.
 */
const DemoQuery = z.object({ isDemo: z.stringbool().default(false) });

export const walletQuery = { query: DemoQuery } as const satisfies RouteSchemas;
export const listTransactions = {
  query: pageOptionsSchema.extend(DemoQuery.shape),
} as const satisfies RouteSchemas;
