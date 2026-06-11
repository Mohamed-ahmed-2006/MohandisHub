import type {
  ApiSuccessBody,
  Plan,
  PlanUsageSummary,
  SubscribeToPlanResponse,
} from '@mohandishub/shared';

import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

async function apiRequest<T>(opts: {
  method: string;
  path: string;
  accessToken?: string;
  body?: unknown;
}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;

  const res = await fetchWithAuthRetry(
    `${getApiBaseUrl()}${opts.path}`,
    {
      method: opts.method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : null,
    },
    opts.accessToken,
  );

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
  listActivePlans: (accessToken: string) =>
    apiRequest<Plan[]>({ method: 'GET', path: '/api/plans', accessToken }),

  getCurrentSubscription: (accessToken: string) =>
    apiRequest<{ subscriptionEndsAt: string } | null>({
      method: 'GET',
      path: '/api/plans/my-subscription',
      accessToken,
    }),

  getMyUsage: (accessToken: string) =>
    apiRequest<PlanUsageSummary>({ method: 'GET', path: '/api/plans/usage', accessToken }),

  subscribe: (accessToken: string, planId: string) =>
    apiRequest<SubscribeToPlanResponse>({
      method: 'POST',
      path: `/api/plans/${planId}/subscribe`,
      accessToken,
    }),
};
