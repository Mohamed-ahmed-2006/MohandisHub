import type { Notification, NotificationPayload, NotificationType } from '@mohandishub/shared';
import { NOTIFICATION_NAVIGATION_MAP } from '@mohandishub/shared';

import { buildLocalePath } from '@/lib/i18n/path';
import type { Locale } from '@/lib/i18n/types';

/** Replace `{key}` with payload string values. */
export function interpolateTemplate(
  template: string,
  payload: NotificationPayload | null | undefined,
): string {
  if (!payload) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = payload[key];
    if (v == null) return '';
    return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  });
}

export type NotificationTemplates = Record<
  string,
  { title?: string; message?: string } | undefined
>;

export function getLocalizedNotificationText(
  n: Notification,
  templates: NotificationTemplates | undefined,
): { title: string; message: string } {
  const t = templates?.[n.type];
  if (t?.title && t?.message) {
    return {
      title: interpolateTemplate(t.title, n.payload),
      message: interpolateTemplate(t.message, n.payload),
    };
  }
  return { title: n.title, message: n.message };
}

export function getNotificationTargetHref(
  type: string,
  payload: NotificationPayload | null,
  locale: Locale,
  _userRole?: string,
): string | null {
  const base = NOTIFICATION_NAVIGATION_MAP[type as NotificationType];
  if (!base) return null;

  const q = new URLSearchParams();
  if (payload?.reservationId) q.set('reservation', String(payload.reservationId));
  // Chat screen reads `c` (see chat-screen.tsx useSearchParams).
  if (payload?.conversationId) q.set('c', String(payload.conversationId));
  if (payload?.needId) q.set('needId', String(payload.needId));
  if (payload?.bidId) q.set('bidId', String(payload.bidId));
  if (payload?.jobId) q.set('job', String(payload.jobId));
  if (payload?.negotiationId) q.set('negotiation', String(payload.negotiationId));
  if (payload?.serviceId) q.set('service', String(payload.serviceId));
  if (payload?.applicationId) q.set('application', String(payload.applicationId));
  const qs = q.toString();
  return buildLocalePath(locale, qs ? `${base}?${qs}` : base);
}
