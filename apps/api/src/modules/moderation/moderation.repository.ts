import { getPool } from '../../db/pool.js';

export class ModerationRepository {
  async insertLog(input: {
    adminUserId: string;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    detail?: Record<string, unknown> | null;
  }): Promise<void> {
    await getPool().query(
      `INSERT INTO admin_moderation_log (admin_user_id, action, entity_type, entity_id, detail)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        input.adminUserId,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        JSON.stringify(input.detail ?? {}),
      ],
    );
  }

  async listLogs(params: { from?: Date; to?: Date; limit: number }): Promise<
    Array<{
      id: string;
      admin_user_id: string;
      action: string;
      entity_type: string | null;
      entity_id: string | null;
      detail: unknown;
      created_at: Date;
    }>
  > {
    const clauses: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (params.from) {
      clauses.push(`created_at >= $${i++}`);
      values.push(params.from);
    }
    if (params.to) {
      clauses.push(`created_at <= $${i++}`);
      values.push(params.to);
    }
    values.push(params.limit);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await getPool().query(
      `SELECT id, admin_user_id, action, entity_type, entity_id, detail, created_at
       FROM admin_moderation_log ${where}
       ORDER BY created_at DESC LIMIT $${i}`,
      values,
    );
    return rows as Array<{
      id: string;
      admin_user_id: string;
      action: string;
      entity_type: string | null;
      entity_id: string | null;
      detail: unknown;
      created_at: Date;
    }>;
  }
}
