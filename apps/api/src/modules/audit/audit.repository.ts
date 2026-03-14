import type { Pool } from 'pg';

import { getPool } from '../../db/pool.js';

export type AuditLogRow = {
  id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  created_at: Date;
};

export type InsertAuditLogInput = {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
};

export class AuditLogRepository {
  constructor(private readonly db: Pool = getPool()) {}

  async insert(input: InsertAuditLogInput): Promise<AuditLogRow> {
    const { rows } = await this.db.query<AuditLogRow>(
      `INSERT INTO audit_log (actor_id, action, resource_type, resource_id, details, ip)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.actorId ?? null,
        input.action,
        input.resourceType,
        input.resourceId ?? null,
        input.details ? JSON.stringify(input.details) : null,
        input.ip ?? null,
      ],
    );
    return rows[0]!;
  }
}
