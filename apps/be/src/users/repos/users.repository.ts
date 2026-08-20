import type { Page, PageOptions } from '@dunx/infra/pagination';
import { and, eq, like, or, type SQL } from 'drizzle-orm';
import { CrudRepository } from '../../infra/db/base.repository.js';
import {
  users,
  type NewUserRow,
  type UserRole,
  type UserRow,
} from '../schema/user.schema.js';

export interface ListUsersFilters extends PageOptions {
  readonly role?: UserRole | undefined;
  readonly banned?: boolean | undefined;
}

export class UsersRepository extends CrudRepository<
  typeof users,
  UserRow,
  NewUserRow
> {
  protected readonly table = users;

  findByEmail(email: string): UserRow | undefined {
    return this.db.select().from(users).where(eq(users.email, email)).get();
  }

  list(filters: ListUsersFilters): Promise<Page<UserRow>> {
    const clauses: SQL[] = [];
    if (filters.role !== undefined) clauses.push(eq(users.role, filters.role));
    if (filters.banned !== undefined) {
      clauses.push(eq(users.banned, filters.banned));
    }
    if (filters.search !== undefined) {
      const term = `%${filters.search}%`;
      const search = or(like(users.email, term), like(users.name, term));
      if (search !== undefined) clauses.push(search);
    }

    return this.page(
      filters,
      clauses.length === 0 ? undefined : and(...clauses),
    );
  }
}
