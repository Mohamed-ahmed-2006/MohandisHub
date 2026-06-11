import type { ApiSuccessBody, ProviderAnalytics } from '@mohandishub/shared';

import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

async function apiReq<T>(path: string, token: string): Promise<T> {
  const res = await fetchWithAuthRetry(
    `${getApiBaseUrl()}${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
    },
    token,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? 'Request failed');
  }
  const json = (await res.json()) as ApiSuccessBody<T>;
  return json.data;
}

export const analyticsApiClient = {
  getMyAnalytics: (token: string): Promise<ProviderAnalytics> => apiReq('/api/analytics/me', token),
};
