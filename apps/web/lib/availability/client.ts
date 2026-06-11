import type { ApiSuccessBody, AvailabilitySlot } from '@mohandishub/shared';

import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

async function apiReq<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  const res = await fetchWithAuthRetry(
    `${getApiBaseUrl()}${path}`,
    {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts?.headers ?? {}),
      },
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

export const availabilityApiClient = {
  listSlots: (
    token: string,
    params: { providerId?: string; from: string; to: string; availableOnly?: boolean },
  ): Promise<{ items: AvailabilitySlot[] }> => {
    const q = new URLSearchParams();
    if (params.providerId) q.set('providerId', params.providerId);
    q.set('from', params.from);
    q.set('to', params.to);
    if (params.availableOnly) q.set('availableOnly', 'true');
    return apiReq(`/api/availability/slots?${q.toString()}`, token);
  },

  createSlot: (
    token: string,
    body: { startAt: string; endAt: string },
  ): Promise<AvailabilitySlot> =>
    apiReq('/api/availability/slots', token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createSlots: (
    token: string,
    body: { slots: Array<{ startAt: string; endAt: string }> },
  ): Promise<{ items: AvailabilitySlot[] }> =>
    apiReq('/api/availability/slots/bulk', token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateSlot: (
    token: string,
    id: string,
    body: { status?: string; startAt?: string; endAt?: string },
  ): Promise<AvailabilitySlot> =>
    apiReq(`/api/availability/slots/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteSlot: (token: string, id: string): Promise<{ deleted: boolean }> =>
    apiReq(`/api/availability/slots/${id}`, token, { method: 'DELETE' }),
};
