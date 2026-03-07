import type { ApiSuccessBody, Plan } from '@mohandishub/shared';

import { getApiBaseUrl } from '@/lib/env';

async function apiRequest<T>(opts: {
  method: string;
  path: string;
  accessToken?: string;
  body?: unknown;
}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;

  const res = await fetch(`${getApiBaseUrl()}${opts.path}`, {
    method: opts.method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : null,
  });

  const json = (await res.json()) as unknown as
    | ApiSuccessBody<T>
    | { error?: { message?: string; code?: string } };
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string } }).error;
    throw new Error(err?.message ?? 'Request failed');
  }
  return (json as ApiSuccessBody<T>).data;
}

export const plansApiClient = {
  listActivePlans: () => apiRequest<Plan[]>({ method: 'GET', path: '/api/plans' }),

  subscribe: (accessToken: string, planId: string) =>
    apiRequest<{ plan: Plan; walletBalance: number }>({
      method: 'POST',
      path: `/api/plans/${planId}/subscribe`,
      accessToken,
    }),
};
