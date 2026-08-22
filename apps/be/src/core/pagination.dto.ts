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

/**
 * Assignable to `@dunx/infra/pagination`'s `PageOptions`, which is what lets the
 * validated query go straight into `paginate` with no adapter. `order` is lowercase
 * (`asc`/`desc`), because that is what the framework's frozen object spells - a
 * client sending `?order=DESC` gets a 400.
 */
export type PageOptionsQuery = z.infer<typeof pageOptionsSchema>;

const pageMetaSchema = z.object({
  take: z.number().int(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
  nextCursor: z.string().nullable(),
  previousCursor: z.string().nullable(),
});

/**
 * The response schema for a page of `item`, named for the OpenAPI components.
 * Deliberately **not** `pageOf`, which is `@dunx/infra/pagination`'s runtime
 * envelope builder - one name for two things is how the wrong import happens.
 */
export class Paginated {
  static of<T extends z.ZodType>(item: T, id: string) {
    return z.object({ data: z.array(item), meta: pageMetaSchema }).meta({ id });
  }
}
