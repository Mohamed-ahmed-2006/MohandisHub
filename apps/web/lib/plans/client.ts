import type {
  ApiSuccessBody,
  Plan,
  PlanUsageSummary,
  SubscribeToPlanResponse,
} from '@mohandishub/shared';

import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

/**
 * Carries the API's error code, not just its message.
 *
 * The plans screen has to react differently to "you need more credits" than to
 * any other failure — it offers a link to buy credits — and matching on a
 * localised message string would break the moment the copy changed.
 */
export class PlanApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | null,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PlanApiError';
  }
}

async function apiRequest<T>(opts: {
  method: string;
  path: string;
  accessToken?: string;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

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
    throw new PlanApiError(err?.message ?? 'Request failed', err?.code ?? null, res.status);
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

  /**
   * @param idempotencyKey stable per submit attempt, so a double click or a
   * retried request reaches the same subscription instead of buying twice. The
   * server enforces it with a unique index, not in memory.
   */
  subscribe: (accessToken: string, planId: string, idempotencyKey?: string) =>
    apiRequest<SubscribeToPlanResponse>({
      method: 'POST',
      path: `/api/plans/${planId}/subscribe`,
      accessToken,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    }),
};
