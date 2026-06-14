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
  getMyAnalytics: (
    token: string,
    params?: { days?: number; from?: string; to?: string },
  ): Promise<ProviderAnalytics> => {
    const query = new URLSearchParams();
    if (params?.days) query.set('days', String(params.days));
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    const qs = query.toString();
    return apiReq(`/api/analytics/me${qs ? `?${qs}` : ''}`, token);
  },
};
