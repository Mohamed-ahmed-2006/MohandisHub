// ---------------------------------------------------------------------------
// Notifications repository — DB access for notifications
// ---------------------------------------------------------------------------

import type {
  NotificationChannel,
  NotificationType,
  PushSubscriptionBody,
} from '@mohandishub/shared';
import type { Pool, PoolClient } from 'pg';

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

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
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

  /**
   * Persist one notification inside the CALLER's transaction.
   *
   * For events that must not exist without the state change that caused them —
   * an advertisement week that was paid for, a renewal that was refused. The
   * caller is responsible for delivery (socket, email, push) AFTER its commit:
   * none of those are transactional, and doing them while a wallet or campaign
   * row is locked would hold the lock across a network call.
   */
  async createInTx(
    client: PoolClient,
    userId: string,
    type: string,
    title: string,
    message: string,
    payload: Record<string, unknown> | null = null,
  ): Promise<NotificationRow> {
    const {
      rows: [row],
    } = await client.query<NotificationRow>(
      `INSERT INTO notifications (user_id, type, title, message, payload)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, type, title, message, payload, read_at, created_at`,
      [userId, type, title, message, payload != null ? JSON.stringify(payload) : null],
    );
    if (!row) throw new Error('Insert notification failed');
    return row;
  }

  /** Stored preferences, read through the caller's transaction. */
  async listPreferencesInTx(
    client: PoolClient,
    userId: string,
  ): Promise<Array<{ notification_type: string; channel: NotificationChannel; enabled: boolean }>> {
    const { rows } = await client.query<{
      notification_type: string;
      channel: NotificationChannel;
      enabled: boolean;
    }>(
      `SELECT notification_type, channel, enabled
       FROM notification_preferences
       WHERE user_id = $1`,
      [userId],
    );
    return rows;
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

  async listPreferences(userId: string): Promise<
    Array<{
      notification_type: string;
      channel: NotificationChannel;
      enabled: boolean;
    }>
  > {
    const { rows } = await this.db.query<{
      notification_type: string;
      channel: NotificationChannel;
      enabled: boolean;
    }>(
      `SELECT notification_type, channel, enabled
       FROM notification_preferences
       WHERE user_id = $1`,
      [userId],
    );
    return rows;
  }

  async upsertPreferences(
    userId: string,
    preferences: Array<{
      notificationType: NotificationType;
      channel: NotificationChannel;
      enabled: boolean;
    }>,
  ): Promise<void> {
    if (preferences.length === 0) return;
    const values = preferences
      .map((_, i) => {
        const base = i * 4;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
      })
      .join(', ');
    const params = preferences.flatMap((p) => [userId, p.notificationType, p.channel, p.enabled]);
    await this.db.query(
      `INSERT INTO notification_preferences (user_id, notification_type, channel, enabled)
       VALUES ${values}
       ON CONFLICT (user_id, notification_type, channel)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
      params,
    );
  }

  async upsertPushSubscription(userId: string, input: PushSubscriptionBody): Promise<void> {
    await this.db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, disabled_at, last_error)
       VALUES ($1, $2, $3, $4, $5, NULL, NULL)
       ON CONFLICT (endpoint)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent,
         disabled_at = NULL,
         last_error = NULL,
         updated_at = now()`,
      [userId, input.endpoint, input.keys.p256dh, input.keys.auth, input.userAgent ?? null],
    );
  }

  async disablePushSubscription(userId: string, endpoint: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE push_subscriptions
       SET disabled_at = now(), updated_at = now()
       WHERE user_id = $1 AND endpoint = $2 AND disabled_at IS NULL`,
      [userId, endpoint],
    );
    return (rowCount ?? 0) > 0;
  }

  async listActivePushSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
    const { rows } = await this.db.query<PushSubscriptionRow>(
      `SELECT id, user_id, endpoint, p256dh, auth
       FROM push_subscriptions
       WHERE user_id = $1 AND disabled_at IS NULL`,
      [userId],
    );
    return rows;
  }

  async markPushDeliverySuccess(subscriptionId: string): Promise<void> {
    await this.db.query(
      `UPDATE push_subscriptions
       SET last_success_at = now(), last_error = NULL, updated_at = now()
       WHERE id = $1`,
      [subscriptionId],
    );
  }

  async markPushDeliveryFailure(
    subscriptionId: string,
    error: string,
    disable: boolean,
  ): Promise<void> {
    await this.db.query(
      `UPDATE push_subscriptions
       SET last_error = $2,
           disabled_at = CASE WHEN $3 THEN now() ELSE disabled_at END,
           updated_at = now()
       WHERE id = $1`,
      [subscriptionId, error.slice(0, 500), disable],
    );
  }

  async recordPushDeliveryAttempt(input: {
    userId: string;
    subscriptionId?: string | null;
    notificationType: string;
    status: 'sent' | 'failed' | 'skipped';
    error?: string | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO push_delivery_attempts
         (user_id, push_subscription_id, notification_type, status, error)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.userId,
        input.subscriptionId ?? null,
        input.notificationType,
        input.status,
        input.error?.slice(0, 500) ?? null,
      ],
    );
  }
}
