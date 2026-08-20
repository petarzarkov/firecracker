import type { Page, PageOptions } from '@dunx/infra/pagination';
import { and, eq, like, type SQL } from 'drizzle-orm';
import { CrudRepository } from '../../infra/db/base.repository.js';
import { files, type FileRow, type NewFileRow } from '../schema/file.schema.js';

export interface ListFilesFilters extends PageOptions {
  readonly userId?: string | undefined;
}

export class FilesRepository extends CrudRepository<
  typeof files,
  FileRow,
  NewFileRow
> {
  protected readonly table = files;

  list(filters: ListFilesFilters): Promise<Page<FileRow>> {
    const clauses: SQL[] = [];
    if (filters.userId !== undefined) {
      clauses.push(eq(files.userId, filters.userId));
    }
    if (filters.search !== undefined) {
      clauses.push(like(files.name, `%${filters.search}%`));
    }

    return this.page(
      filters,
      clauses.length === 0 ? undefined : and(...clauses),
    );
  }
}
