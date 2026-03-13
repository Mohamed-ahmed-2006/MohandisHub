// ---------------------------------------------------------------------------
// Notifications controller — list, unread count, mark read
// ---------------------------------------------------------------------------

import type { ApiSuccessBody } from '@mohandishub/shared';
import type { Request } from 'express';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { NotificationsService } from './notifications.service.js';

const notificationsService = new NotificationsService();

function requireUserId(req: Request): string {
  if (!req.user?.id) {
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Authentication required.' });
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
  const response: ApiSuccessBody<{ unreadCount: number }> = { ok: true, data: { unreadCount: count } };
  res.json(response);
});

export const markAsRead = asyncHandler(async (req, res) => {
  const userId = requireUserId(req);
  const id = req.params.id;
  if (!id) {
    throw new HttpError({ statusCode: 400, code: 'BAD_REQUEST', message: 'Notification id required.' });
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

/** POST /api/notifications/demo — create a test notification for the current user. */
export const sendDemo = asyncHandler(async (req, res) => {
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
  markAsRead,
  markAllAsRead,
  sendDemo,
};
