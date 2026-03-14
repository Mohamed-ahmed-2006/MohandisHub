import { hasDatabaseConfig } from '../../db/pool.js';

import { AuditLogRepository } from './audit.repository.js';

export type AuditLogInput = {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
};

let repo: AuditLogRepository | null = null;

function getRepo(): AuditLogRepository {
  if (!repo) repo = new AuditLogRepository();
  return repo;
}

export async function logAudit(input: AuditLogInput): Promise<void> {
  if (!hasDatabaseConfig()) return;
  await getRepo().insert({
    actorId: input.actorId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    details: input.details ?? null,
    ip: input.ip ?? null,
  });
}
