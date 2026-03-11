import type { Review } from '@mohandishub/shared';

import { getApiBaseUrl } from '@/lib/env';

type ReviewListResponse = {
  items: Review[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

async function apiReq<T>(path: string, accessToken: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? 'Request failed');
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

export const reviewsApiClient = {
  list: (
    accessToken: string,
    params: {
      targetUserId: string;
      targetType: 'expert' | 'business' | 'customer';
      page?: number;
      limit?: number;
    },
  ) => {
    const sp = new URLSearchParams();
    sp.set('targetUserId', params.targetUserId);
    sp.set('targetType', params.targetType);
    if (params.page != null) sp.set('page', String(params.page));
    if (params.limit != null) sp.set('limit', String(params.limit));
    return apiReq<ReviewListResponse>(`/api/reviews?${sp.toString()}`, accessToken);
  },

  create: (
    accessToken: string,
    body: {
      reservationId?: string;
      bookingId?: string;
      needId?: string;
      rating: number;
      comment?: string;
    },
  ) =>
    apiReq<Review>('/api/reviews', accessToken, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  report: (
    accessToken: string,
    reviewId: string,
    body: { reason: 'inappropriate' | 'fake' | 'spam' | 'other'; comment?: string },
  ) =>
    apiReq<{ id: string }>(`/api/reviews/${reviewId}/report`, accessToken, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  dispute: (accessToken: string, reviewId: string, body: { reason: string }) =>
    apiReq<{ id: string }>(`/api/reviews/${reviewId}/dispute`, accessToken, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
