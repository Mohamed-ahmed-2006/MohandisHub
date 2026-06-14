import type {
  ApiSuccessBody,
  RecommendationConsent,
  RecommendationListResponse,
} from '@mohandishub/shared';

import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

async function requestJson<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithAuthRetry(
    `${getApiBaseUrl()}${path}`,
    {
      ...init,
      credentials: 'include',
      headers: {
        ...(init?.headers as Record<string, string>),
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    },
    accessToken,
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? 'Request failed');
  }
  return ((await response.json()) as ApiSuccessBody<T>).data;
}

export const recommendationsApiClient = {
  list: (accessToken: string, limit = 10): Promise<RecommendationListResponse> =>
    requestJson(accessToken, `/api/recommendations?limit=${encodeURIComponent(String(limit))}`),

  getConsent: (accessToken: string): Promise<RecommendationConsent> =>
    requestJson(accessToken, '/api/recommendations/consent'),

  setConsent: (accessToken: string, enabled: boolean): Promise<RecommendationConsent> =>
    requestJson(accessToken, '/api/recommendations/consent', {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),

  recordEvent: (
    accessToken: string,
    body: {
      eventType: 'service_view' | 'search' | 'saved_search' | 'booking' | 'rating';
      serviceId?: string;
      categoryId?: string;
      city?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<{ recorded: boolean }> =>
    requestJson(accessToken, '/api/recommendations/events', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  clearEvents: (accessToken: string): Promise<{ deleted: number }> =>
    requestJson(accessToken, '/api/recommendations/events', { method: 'DELETE' }),
};
