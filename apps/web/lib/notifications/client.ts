import type { ApiErrorBody, ApiSuccessBody, NotificationListResponse } from '@mohandishub/shared';

import { ApiClientRequestError } from '../auth/client';

import { getApiBaseUrl } from '@/lib/env';

async function requestJson<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.headers as Record<string, string>),
      Authorization: `Bearer ${accessToken}`,
      ...(init?.method !== 'GET' && init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

  if (!response.ok) {
    const rawErrorBody: unknown = await response.json().catch(() => null);
    const maybeError = rawErrorBody as ApiErrorBody | null;
    if (maybeError?.error) {
      throw new ApiClientRequestError({
        code: maybeError.error.code,
        message: maybeError.error.message,
        status: response.status,
        details: maybeError.error.details,
      });
    }
    throw new ApiClientRequestError({
      code: 'HTTP_ERROR',
      message: `Request failed with status ${response.status}`,
      status: response.status,
    });
  }

  const bodyJson = (await response.json()) as ApiSuccessBody<T>;
  return bodyJson.data;
}

export const notificationsApiClient = {
  getNotifications: (accessToken: string, params?: { page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return requestJson<NotificationListResponse>(
      accessToken,
      `/api/notifications${qs ? `?${qs}` : ''}`,
    );
  },

  getUnreadCount: (accessToken: string) =>
    requestJson<{ unreadCount: number }>(accessToken, '/api/notifications/unread-count'),

  markAsRead: (accessToken: string, id: string) =>
    requestJson<{ updated: boolean }>(accessToken, `/api/notifications/${id}/read`, {
      method: 'PATCH',
    }),

  markAllAsRead: (accessToken: string) =>
    requestJson<{ updated: number }>(accessToken, '/api/notifications/read-all', {
      method: 'PATCH',
    }),

  /** Create a demo notification for the current user. */
  sendDemo: (accessToken: string) =>
    requestJson<{ id: string; type: string; title: string; message: string; readAt: string | null; createdAt: string }>(
      accessToken,
      '/api/notifications/demo',
      { method: 'POST' },
    ),
};
