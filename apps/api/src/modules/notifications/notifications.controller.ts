// ---------------------------------------------------------------------------
// Notifications controller — list, unread count, mark read
// ---------------------------------------------------------------------------

import type { ApiSuccessBody } from '@mohandishub/shared';
import type { Request } from 'express';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { NotificationsService } from './notifications.service.js';

const notificationsService = new NotificationsService();

const channelSchema = z.enum(['in_app', 'email', 'push']);
const updatePreferencesSchema = z.object({
  preferences: z.array(
    z.object({
      notificationType: z.string(),
      channel: channelSchema,
      enabled: z.boolean(),
    }),
  ),
});
const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(20).max(500),
    auth: z.string().min(10).max(500),
  }),
  userAgent: z.string().max(500).optional(),
});
const disablePushSchema = z.object({
  endpoint: z.string().url().max(2000),
});

function requireUserId(req: Request): string {
  if (!req.user?.id) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.user.id;
}

export const getNotifications = asyncHandler(async (req, res) => {
  const userId = requireUserId(req);
  const pageRaw = typeof req.query.page === 'string' ? req.query.page : '1';
  const limitRaw = typeof req.query.limit === 'string' ? req.query.limit : '20';
  const page = Math.max(1, parseInt(pageRaw, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(limitRaw, 10) || 20));
  const result = await notificationsService.listByUserId(userId, page, limit);
  const response: ApiSuccessBody<typeof result> = { ok: true, data: result };
  res.json(response);
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = requireUserId(req);
  const count = await notificationsService.getUnreadCount(userId);
  const response: ApiSuccessBody<{ unreadCount: number }> = {
    ok: true,
    data: { unreadCount: count },
  };
  res.json(response);
});

export const markAsRead = asyncHandler(async (req, res) => {
  const userId = requireUserId(req);
  const id = req.params.id;
  if (!id) {
    throw new HttpError({
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: 'Notification id required.',
    });
  }
  const updated = await notificationsService.markAsRead(id, userId);
  const response: ApiSuccessBody<{ updated: boolean }> = { ok: true, data: { updated } };
  res.json(response);
});

export const markAllAsRead = asyncHandler(async (req, res) => {
  const userId = requireUserId(req);
  const count = await notificationsService.markAllAsRead(userId);
  const response: ApiSuccessBody<{ updated: number }> = { ok: true, data: { updated: count } };
  res.json(response);
});

export const getPreferences = asyncHandler(async (req, res) => {
  const userId = requireUserId(req);
  const data = await notificationsService.listPreferences(userId);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const updatePreferences = asyncHandler(async (req, res) => {
  const userId = requireUserId(req);
  const parsed = updatePreferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid notification preferences.',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const data = await notificationsService.updatePreferences(userId, {
    preferences: parsed.data.preferences.map((p) => ({
      notificationType: p.notificationType as never,
      channel: p.channel,
      enabled: p.enabled,
    })),
  });
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const getPushReadiness = asyncHandler((_req, res) => {
  const data = notificationsService.getPushReadiness();
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const upsertPushSubscription = asyncHandler(async (req, res) => {
  const userId = requireUserId(req);
  const parsed = pushSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid push subscription.',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const input = {
    endpoint: parsed.data.endpoint,
    keys: parsed.data.keys,
    ...(parsed.data.userAgent ? { userAgent: parsed.data.userAgent } : {}),
  };
  const data = await notificationsService.upsertPushSubscription(userId, input);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.status(201).json(response);
});

export const disablePushSubscription = asyncHandler(async (req, res) => {
  const userId = requireUserId(req);
  const parsed = disablePushSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid push subscription.',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const data = await notificationsService.disablePushSubscription(userId, parsed.data.endpoint);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

/** POST /api/notifications/demo — create a test notification for the current user. */
export const sendDemo = asyncHandler(async (req, res) => {
  if (env.NODE_ENV === 'production') {
    throw new HttpError({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Not found.',
    });
  }

  const userId = requireUserId(req);
  const notification = await notificationsService.createForUser(userId, {
    type: 'demo',
    title: 'Test notification',
    message: 'This is a demo notification.',
  });
  const response: ApiSuccessBody<typeof notification> = { ok: true, data: notification };
  res.status(201).json(response);
});

export const notificationsController = {
  getNotifications,
  getUnreadCount,
  getPreferences,
  updatePreferences,
  getPushReadiness,
  upsertPushSubscription,
  disablePushSubscription,
  markAsRead,
  markAllAsRead,
  sendDemo,
};
