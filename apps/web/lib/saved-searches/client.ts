import type { SavedSearch, UpsertSavedSearchBody } from '@mohandishub/shared';

import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

const request = async <T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetchWithAuthRetry(
    `${getApiBaseUrl()}${path}`,
    {
      credentials: 'include',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers ?? {}),
      },
    },
    accessToken,
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body &&
      'error' in body &&
      typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
        ? (body as { error: { message: string } }).error.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return (body as { data: T }).data;
};

export const savedSearchesApiClient = {
  list: (accessToken: string, kind?: 'service' | 'need') => {
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : '';
    return request<SavedSearch[]>(accessToken, `/api/saved-searches${qs}`);
  },

  create: (accessToken: string, body: UpsertSavedSearchBody) =>
    request<SavedSearch>(accessToken, '/api/saved-searches', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (accessToken: string, id: string, body: Partial<UpsertSavedSearchBody>) =>
    request<SavedSearch>(accessToken, `/api/saved-searches/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  markViewed: (accessToken: string, id: string) =>
    request<SavedSearch>(accessToken, `/api/saved-searches/${encodeURIComponent(id)}/viewed`, {
      method: 'POST',
    }),

  delete: (accessToken: string, id: string) =>
    request<{ deleted: boolean }>(accessToken, `/api/saved-searches/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};
