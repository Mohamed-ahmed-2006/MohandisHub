import type {
  ApiErrorBody,
  ApiSuccessBody,
  NotificationListResponse,
  NotificationPreferencesResponse,
  PushSubscriptionBody,
  UpdateNotificationPreferencesBody,
} from '@mohandishub/shared';

import { ApiClientRequestError } from '../auth/client';

import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

type RequestOptions = RequestInit & {
  refreshSession?: () => Promise<string | null>;
};

async function fetchJson<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithAuthRetry(
    `${getApiBaseUrl()}${path}`,
    {
      ...init,
      credentials: 'include',
      headers: {
        ...(init?.headers as Record<string, string>),
        Authorization: `Bearer ${accessToken}`,
        ...(init?.method !== 'GET' && init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    },
    accessToken,
  );

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

async function requestJson<T>(
  accessToken: string,
  path: string,
  init?: RequestOptions,
): Promise<T> {
  const requestInit: RequestInit = { ...(init ?? {}) };
  delete (requestInit as RequestOptions).refreshSession;
  return fetchJson<T>(accessToken, path, requestInit);
}

export const notificationsApiClient = {
  getNotifications: (
    accessToken: string,
    params?: { page?: number; limit?: number },
    options?: { refreshSession?: () => Promise<string | null> },
  ) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return requestJson<NotificationListResponse>(
      accessToken,
      `/api/notifications${qs ? `?${qs}` : ''}`,
      options,
    );
  },

  getUnreadCount: (
    accessToken: string,
    options?: { refreshSession?: () => Promise<string | null> },
  ) =>
    requestJson<{ unreadCount: number }>(accessToken, '/api/notifications/unread-count', options),

  getPreferences: (
    accessToken: string,
    options?: { refreshSession?: () => Promise<string | null> },
  ) =>
    requestJson<NotificationPreferencesResponse>(
      accessToken,
      '/api/notifications/preferences',
      options,
    ),

  updatePreferences: (
    accessToken: string,
    body: UpdateNotificationPreferencesBody,
    options?: { refreshSession?: () => Promise<string | null> },
  ) =>
    requestJson<NotificationPreferencesResponse>(accessToken, '/api/notifications/preferences', {
      method: 'PATCH',
      body: JSON.stringify(body),
      ...options,
    }),

  getPushReadiness: (
    accessToken: string,
    options?: { refreshSession?: () => Promise<string | null> },
  ) =>
    requestJson<{ enabled: boolean; publicKey: string | null }>(
      accessToken,
      '/api/notifications/push/readiness',
      options,
    ),

  savePushSubscription: (
    accessToken: string,
    body: PushSubscriptionBody,
    options?: { refreshSession?: () => Promise<string | null> },
  ) =>
    requestJson<{ configured: boolean }>(accessToken, '/api/notifications/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify(body),
      ...options,
    }),

  markAsRead: (
    accessToken: string,
    id: string,
    options?: { refreshSession?: () => Promise<string | null> },
  ) =>
    requestJson<{ updated: boolean }>(accessToken, `/api/notifications/${id}/read`, {
      method: 'PATCH',
      ...options,
    }),

  markAllAsRead: (
    accessToken: string,
    options?: { refreshSession?: () => Promise<string | null> },
  ) =>
    requestJson<{ updated: number }>(accessToken, '/api/notifications/read-all', {
      method: 'PATCH',
      ...options,
    }),

  /** Create a demo notification for the current user. */
  sendDemo: (accessToken: string, options?: { refreshSession?: () => Promise<string | null> }) =>
    requestJson<{
      id: string;
      type: string;
      title: string;
      message: string;
      readAt: string | null;
      createdAt: string;
    }>(accessToken, '/api/notifications/demo', { method: 'POST', ...options }),
};
