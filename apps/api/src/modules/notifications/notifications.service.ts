// ---------------------------------------------------------------------------
// Notifications service — create, list, mark read; emit via Socket; optional email
// ---------------------------------------------------------------------------

import type {
  NotificationCategory,
  NotificationChannel,
  NotificationPayload,
  NotificationPreferenceGroup,
  NotificationType,
  PushSubscriptionBody,
  UpdateNotificationPreferencesBody,
} from '@mohandishub/shared';
import webpush from 'web-push';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { getSocketServer } from '../../lib/socket-instance.js';
import { sendTransactionalEmail } from '../../utils/send-transactional-email.js';

import { NotificationsRepository } from './notifications.repository.js';
import type { NotificationRow } from './notifications.repository.js';

const ALL_CHANNELS: NotificationChannel[] = ['in_app', 'email', 'push'];

const CATEGORY_BY_TYPE: Record<string, NotificationCategory> = {
  reservation_created: 'reservations',
  reservation_accepted: 'reservations',
  reservation_rejected: 'reservations',
  reservation_cancelled: 'reservations',
  reservation_completed: 'reservations',
  reservation_started: 'reservations',
  reservation_expired: 'reservations',
  reservation_location_proposed: 'reservations',
  reservation_disputed: 'disputes',
  reservation_dispute_resolved: 'disputes',
  wallet_deposit_approved: 'wallet',
  wallet_deposit_rejected: 'wallet',
  wallet_deposit_confirmed: 'wallet',
  wallet_withdrawal_completed: 'withdrawals',
  wallet_withdrawal_rejected: 'withdrawals',
  new_message: 'messages',
  chat_message: 'messages',
  job_application: 'jobs',
  job_interview_booked: 'jobs',
  application_status: 'jobs',
  milestone_submitted: 'jobs',
  milestone_reviewed: 'jobs',
  need_bid_received: 'jobs',
  need_bid_awarded: 'jobs',
  need_bid_rejected: 'jobs',
  need_bid_paid: 'jobs',
  need_closed: 'jobs',
  service_approved: 'services',
  service_rejected: 'services',
  service_paused_by_admin: 'services',
  review_received: 'reviews',
  review_report_resolved: 'reviews',
  review_dispute_resolved: 'reviews',
  price_negotiation: 'services',
  admin: 'admin',
  demo: 'marketing',
};

const NOTIFICATION_TYPES = Object.keys(CATEGORY_BY_TYPE) as NotificationType[];

const REQUIRED_IN_APP = new Set<string>([
  'reservation_created',
  'reservation_accepted',
  'reservation_cancelled',
  'reservation_completed',
  'reservation_expired',
  'reservation_disputed',
  'reservation_dispute_resolved',
  'wallet_deposit_approved',
  'wallet_deposit_rejected',
  'wallet_deposit_confirmed',
  'wallet_withdrawal_completed',
  'wallet_withdrawal_rejected',
]);

const REQUIRED_EMAIL = new Set<string>([]);

export function getNotificationCategory(type: string): NotificationCategory {
  return CATEGORY_BY_TYPE[type] ?? 'admin';
}

export function isNotificationChannelRequired(type: string, channel: NotificationChannel): boolean {
  return (
    (channel === 'in_app' && REQUIRED_IN_APP.has(type)) ||
    (channel === 'email' && REQUIRED_EMAIL.has(type))
  );
}

/** True if the error is Postgres "relation does not exist" for notifications table. */
function isNotificationsTableMissing(err: unknown): boolean {
  const pg = err as { code?: string; message?: string };
  return (
    pg?.code === '42P01' && typeof pg?.message === 'string' && pg.message.includes('notifications')
  );
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
      const prefs = await this.getEffectivePreferenceMap(userId);
      const type = input.type as NotificationType;
      const shouldPersistInApp =
        isNotificationChannelRequired(input.type, 'in_app') ||
        (prefs.get(`${type}:in_app`) ?? true);
      const shouldEmail =
        input.recipientEmail != null &&
        (isNotificationChannelRequired(input.type, 'email') ||
          (prefs.get(`${type}:email`) ?? true));
      const shouldPush = prefs.get(`${type}:push`) ?? true;

      if (!shouldPersistInApp) {
        if (shouldEmail && input.recipientEmail) {
          void this.sendNotificationEmail(userId, input);
        }
        if (shouldPush) void this.sendPushNotifications(userId, input);
        return {
          id: 'suppressed-in-app',
          userId,
          type: input.type,
          title: input.title,
          message: input.message,
          payload: input.payload ?? null,
          readAt: null,
          createdAt: new Date().toISOString(),
        };
      }

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
      if (shouldEmail) void this.sendNotificationEmail(userId, input);
      if (shouldPush) void this.sendPushNotifications(userId, input);
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
    let created = 0;
    for (const uid of userIds) {
      const result = await this.createForUser(uid, input);
      if (result.id !== 'suppressed-in-app' && result.id !== 'stub-no-table') created += 1;
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

  async listPreferences(userId: string): Promise<{ groups: NotificationPreferenceGroup[] }> {
    const stored = await this.repo.listPreferences(userId);
    const storedMap = new Map(
      stored.map((p) => [`${p.notification_type}:${p.channel}`, p.enabled]),
    );
    const byCategory = new Map<NotificationCategory, NotificationPreferenceGroup>();

    for (const notificationType of NOTIFICATION_TYPES) {
      const category = getNotificationCategory(notificationType);
      const group =
        byCategory.get(category) ??
        ({
          category,
          required: false,
          preferences: [],
        } satisfies NotificationPreferenceGroup);
      for (const channel of ALL_CHANNELS) {
        const required = isNotificationChannelRequired(notificationType, channel);
        group.required = group.required || required;
        group.preferences.push({
          notificationType,
          category,
          channel,
          enabled: required || (storedMap.get(`${notificationType}:${channel}`) ?? true),
          required,
        });
      }
      byCategory.set(category, group);
    }

    return { groups: [...byCategory.values()] };
  }

  async updatePreferences(
    userId: string,
    input: UpdateNotificationPreferencesBody,
  ): Promise<{ groups: NotificationPreferenceGroup[] }> {
    const normalized = input.preferences
      .filter((p) => NOTIFICATION_TYPES.includes(p.notificationType))
      .map((p) => ({
        ...p,
        enabled: isNotificationChannelRequired(p.notificationType, p.channel) ? true : p.enabled,
      }));
    await this.repo.upsertPreferences(userId, normalized);
    return this.listPreferences(userId);
  }

  async upsertPushSubscription(
    userId: string,
    input: PushSubscriptionBody,
  ): Promise<{ configured: boolean }> {
    await this.repo.upsertPushSubscription(userId, input);
    return {
      configured:
        env.WEB_PUSH_ENABLED &&
        Boolean(env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY),
    };
  }

  async disablePushSubscription(userId: string, endpoint: string): Promise<{ updated: boolean }> {
    return { updated: await this.repo.disablePushSubscription(userId, endpoint) };
  }

  getPushReadiness(): { enabled: boolean; publicKey: string | null } {
    return {
      enabled:
        env.WEB_PUSH_ENABLED &&
        Boolean(env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY),
      publicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY ?? null,
    };
  }

  private async getEffectivePreferenceMap(userId: string): Promise<Map<string, boolean>> {
    const maybeRepo = this.repo as NotificationsRepository & {
      listPreferences?: NotificationsRepository['listPreferences'];
    };
    if (typeof maybeRepo.listPreferences !== 'function') return new Map();
    const stored = await maybeRepo.listPreferences(userId);
    return new Map(stored.map((p) => [`${p.notification_type}:${p.channel}`, p.enabled]));
  }

  private sendNotificationEmail(userId: string, input: CreateNotificationInput) {
    if (!input.recipientEmail) return;
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

  private async sendPushNotifications(userId: string, input: CreateNotificationInput) {
    if (
      !env.WEB_PUSH_ENABLED ||
      !env.WEB_PUSH_VAPID_PUBLIC_KEY ||
      !env.WEB_PUSH_VAPID_PRIVATE_KEY ||
      !env.WEB_PUSH_SUBJECT
    ) {
      await this.repo
        .recordPushDeliveryAttempt({
          userId,
          notificationType: input.type,
          status: 'skipped',
          error: 'WEB_PUSH_NOT_CONFIGURED',
        })
        .catch(() => undefined);
      return;
    }

    webpush.setVapidDetails(
      env.WEB_PUSH_SUBJECT,
      env.WEB_PUSH_VAPID_PUBLIC_KEY,
      env.WEB_PUSH_VAPID_PRIVATE_KEY,
    );

    const subscriptions = await this.repo.listActivePushSubscriptions(userId).catch((err) => {
      logger.warn('Push subscription lookup failed', { err, userId, type: input.type });
      return [];
    });

    if (subscriptions.length === 0) {
      await this.repo
        .recordPushDeliveryAttempt({
          userId,
          notificationType: input.type,
          status: 'skipped',
          error: 'NO_ACTIVE_SUBSCRIPTIONS',
        })
        .catch(() => undefined);
      return;
    }

    const payload = JSON.stringify({
      title: input.title,
      body: input.message,
      data: {
        type: input.type,
        payload: input.payload ?? null,
      },
    });

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            payload,
          );
          await this.repo.markPushDeliverySuccess(sub.id);
          await this.repo.recordPushDeliveryAttempt({
            userId,
            subscriptionId: sub.id,
            notificationType: input.type,
            status: 'sent',
          });
        } catch (err) {
          const statusCode =
            typeof (err as { statusCode?: unknown }).statusCode === 'number'
              ? (err as { statusCode: number }).statusCode
              : null;
          const disable = statusCode === 404 || statusCode === 410;
          const message = err instanceof Error ? err.message : 'Push send failed';
          await this.repo.markPushDeliveryFailure(sub.id, message, disable).catch(() => undefined);
          await this.repo
            .recordPushDeliveryAttempt({
              userId,
              subscriptionId: sub.id,
              notificationType: input.type,
              status: 'failed',
              error: message,
            })
            .catch(() => undefined);
          logger.warn('Push notification send failed', {
            userId,
            type: input.type,
            statusCode,
            disabled: disable,
            err,
          });
        }
      }),
    );
  }
}
