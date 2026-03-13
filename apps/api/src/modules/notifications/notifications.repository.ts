// ---------------------------------------------------------------------------
// Notifications repository — DB access for notifications
// ---------------------------------------------------------------------------

import type { Pool } from 'pg';

import { getPool } from '../../db/pool.js';

export type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  payload: Record<string, unknown> | null;
  read_at: Date | null;
  created_at: Date;
};

export class NotificationsRepository {
  constructor(private readonly db: Pool = getPool()) {}

  async create(
    userId: string,
    type: string,
    title: string,
    message: string,
    payload: Record<string, unknown> | null = null,
  ): Promise<NotificationRow> {
    const {
      rows: [row],
    } = await this.db.query<NotificationRow>(
      `INSERT INTO notifications (user_id, type, title, message, payload)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, type, title, message, payload, read_at, created_at`,
      [userId, type, title, message, payload != null ? JSON.stringify(payload) : null],
    );
    if (!row) throw new Error('Insert notification failed');
    return row;
  }

  async createMany(
    userIds: string[],
    type: string,
    title: string,
    message: string,
    payload: Record<string, unknown> | null = null,
  ): Promise<number> {
    if (userIds.length === 0) return 0;
    const payloadJson = payload != null ? JSON.stringify(payload) : null;
    const values = userIds
      .map((_, i) => {
        const base = i * 5;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      })
      .join(', ');
    const params = userIds.flatMap((uid) => [uid, type, title, message, payloadJson]);
    const { rowCount } = await this.db.query(
      `INSERT INTO notifications (user_id, type, title, message, payload) VALUES ${values}`,
      params,
    );
    return rowCount ?? 0;
  }

  async listByUserId(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ rows: NotificationRow[]; total: number }> {
    const offset = (page - 1) * limit;
    const [countResult, listResult] = await Promise.all([
      this.db.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM notifications WHERE user_id = $1',
        [userId],
      ),
      this.db.query<NotificationRow>(
        `SELECT id, user_id, type, title, message, payload, read_at, created_at
         FROM notifications WHERE user_id = $1
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      ),
    ]);
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
    return { rows: listResult.rows, total };
  }

  async getUnreadCount(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [userId],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  async markAsRead(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      'UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL',
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }

  async markAllAsRead(userId: string): Promise<number> {
    const { rowCount } = await this.db.query(
      'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
      [userId],
    );
    return rowCount ?? 0;
  }
}
