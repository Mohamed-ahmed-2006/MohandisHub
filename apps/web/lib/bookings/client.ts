import type { ApiSuccessBody, Booking } from '@mohandishub/shared';

import { getApiBaseUrl } from '@/lib/env';

async function apiReq<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? 'Request failed');
  }
  const json = (await res.json()) as ApiSuccessBody<T>;
  return json.data;
}

export const bookingsApiClient = {
  listMy: (
    token: string,
    params: { role?: 'customer' | 'provider'; page?: number; limit?: number },
  ): Promise<{ items: Booking[]; total: number; page: number; limit: number; totalPages: number }> => {
    const q = new URLSearchParams();
    if (params.role) q.set('role', params.role);
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiReq(`/api/bookings/my${qs ? `?${qs}` : ''}`, token);
  },

  getById: (token: string, id: string): Promise<Booking> =>
    apiReq(`/api/bookings/${id}`, token),

  create: (
    token: string,
    body: { serviceId: string; slotStartAt: string; slotEndAt: string },
  ): Promise<Booking> =>
    apiReq('/api/bookings', token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (token: string, id: string, body: { status: string }): Promise<Booking> =>
    apiReq(`/api/bookings/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};
