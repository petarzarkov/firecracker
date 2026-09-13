import {
  PAGINATION,
  PaginationDirection,
  PaginationOrder,
} from '@dunx/infra/pagination';
import { z } from 'zod';

/**
 * The zod half of pagination, and the only half this app owns. dunx's route
 * validation targets Standard Schema, so `@dunx/infra` ships no zod schema -
 * shipping one would pick a validator for every consumer - and exports the
 * constants instead. The bounds are stated here but not *invented* here.
 */
export const pageOptionsSchema = z.object({
  order: z
    .enum([PaginationOrder.ASC, PaginationOrder.DESC])
    .default(PAGINATION.DEFAULT_ORDER),
  direction: z
    .enum([PaginationDirection.FORWARD, PaginationDirection.BACKWARD])
    .default(PAGINATION.DEFAULT_DIRECTION),
  take: z.coerce
    .number()
    .int()
    .min(PAGINATION.MIN_TAKE)
    .max(PAGINATION.MAX_TAKE)
    .default(PAGINATION.DEFAULT_TAKE),
  cursor: z.string().max(PAGINATION.MAX_CURSOR).optional(),
  search: z.string().min(1).max(PAGINATION.MAX_SEARCH).optional(),
});
