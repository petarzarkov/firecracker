import type { Page } from '@dunx/infra/pagination';
import type { AuditLogEntry } from '../dto/audit-log.dto.js';
import type { AuditLogRow } from '../schema/audit-log.schema.js';
import {
  AuditLogRepository,
  type AuditFilters,
} from '../repos/audit-log.repository.js';

export class AuditService {
  static #present(row: AuditLogRow): AuditLogEntry {
    return {
      id: row.id,
      actorId: row.actorId,
      action: row.action,
      entityName: row.entityName,
      entityId: row.entityId,
      oldValues: row.oldValues,
      newValues: row.newValues,
      createdAt: row.createdAt.toISOString(),
    };
  }

  constructor(private readonly repo: AuditLogRepository) {}

  async list(filters: AuditFilters): Promise<Page<AuditLogEntry>> {
    const page = await this.repo.list(filters);
    return { data: page.data.map(AuditService.#present), meta: page.meta };
  }
}
