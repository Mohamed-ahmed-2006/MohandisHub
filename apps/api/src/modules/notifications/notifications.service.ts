// ---------------------------------------------------------------------------
// Notifications service — create, list, mark read; emit via Socket; optional email
// ---------------------------------------------------------------------------

import type { NotificationPayload } from '@mohandishub/shared';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { getSocketServer } from '../../lib/socket-instance.js';
import { sendTransactionalEmail } from '../../utils/send-transactional-email.js';

import { NotificationsRepository } from './notifications.repository.js';
import type { NotificationRow } from './notifications.repository.js';

/** True if the error is Postgres "relation does not exist" for notifications table. */
function isNotificationsTableMissing(err: unknown): boolean {
  const pg = err as { code?: string; message?: string };
  return pg?.code === '42P01' && typeof pg?.message === 'string' && pg.message.includes('notifications');
}

function canUseMissingTableFallback(): boolean {
  return env.NODE_ENV !== 'production';
}

export type CreateNotificationInput = {
  type: string;
  title: string;
  message: string;
  payload?: NotificationPayload | null;
  /** When set, a transactional email is also sent (fire-and-forget). */
  recipientEmail?: string;
  recipientDisplayName?: string;
};

export class NotificationsService {
  constructor(private readonly repo: NotificationsRepository = new NotificationsRepository()) {}

  private toNotification(row: NotificationRow) {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      title: row.title,
      message: row.message,
      payload: row.payload,
      readAt: row.read_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  }

  /** Create one notification, persist, and emit to user's Socket room. Optionally send email when recipientEmail is set. */
  async createForUser(userId: string, input: CreateNotificationInput) {
    try {
      const row = await this.repo.create(
        userId,
        input.type,
        input.title,
        input.message,
        input.payload ?? null,
      );
      const io = getSocketServer();
      if (io) {
        io.to(`user:${userId}`).emit('notification', {
          id: row.id,
          type: row.type,
          title: row.title,
          message: row.message,
          payload: row.payload,
          readAt: null,
          createdAt: row.created_at.toISOString(),
        });
      }
      if (input.recipientEmail) {
        const emailParams: Parameters<typeof sendTransactionalEmail>[0] = {
          to: input.recipientEmail,
          subject: input.title,
          preheader: input.message.slice(0, 120),
          title: input.title,
          introLines: [input.message],
        };
        if (input.recipientDisplayName != null) emailParams.displayName = input.recipientDisplayName;
        sendTransactionalEmail(emailParams).catch((err: unknown) =>
          logger.warn('Notification email send failed', { err, userId, type: input.type }),
        );
      }
      return this.toNotification(row);
    } catch (err) {
      if (isNotificationsTableMissing(err) && canUseMissingTableFallback()) {
        const now = new Date();
        return {
          id: 'stub-no-table',
          userId,
          type: input.type,
          title: input.title,
          message: input.message,
          payload: input.payload ?? null,
          readAt: null,
          createdAt: now.toISOString(),
        };
      }
      throw err;
    }
  }

  /** Create notifications for multiple users (e.g. admin broadcast); emit to each. */
  async createForUsers(
    userIds: string[],
    input: CreateNotificationInput,
  ): Promise<{ created: number }> {
    if (userIds.length === 0) return { created: 0 };
    const created = await this.repo.createMany(
      userIds,
      input.type,
      input.title,
      input.message,
      input.payload ?? null,
    );
    const io = getSocketServer();
    if (io) {
      const payload = {
        type: input.type,
        title: input.title,
        message: input.message,
        payload: input.payload ?? null,
        readAt: null as string | null,
        createdAt: new Date().toISOString(),
      };
      for (const uid of userIds) {
        io.to(`user:${uid}`).emit('notification', { id: undefined, ...payload });
      }
    }
    return { created };
  }

  async listByUserId(userId: string, page: number = 1, limit: number = 20) {
    try {
      const { rows, total } = await this.repo.listByUserId(userId, page, limit);
      return {
        items: rows.map((r) => this.toNotification(r)),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (err) {
      if (isNotificationsTableMissing(err) && canUseMissingTableFallback()) {
        return { items: [], total: 0, page, limit, totalPages: 0 };
      }
      throw err;
    }
  }

  async getUnreadCount(userId: string): Promise<number> {
    try {
      return await this.repo.getUnreadCount(userId);
    } catch (err) {
      if (isNotificationsTableMissing(err) && canUseMissingTableFallback()) return 0;
      throw err;
    }
  }

  async markAsRead(id: string, userId: string): Promise<boolean> {
    try {
      return await this.repo.markAsRead(id, userId);
    } catch (err) {
      if (isNotificationsTableMissing(err) && canUseMissingTableFallback()) return false;
      throw err;
    }
  }

  async markAllAsRead(userId: string): Promise<number> {
    try {
      return await this.repo.markAllAsRead(userId);
    } catch (err) {
      if (isNotificationsTableMissing(err) && canUseMissingTableFallback()) return 0;
      throw err;
    }
  }
}
