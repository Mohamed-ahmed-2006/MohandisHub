import type { AuthUser } from '@mohandishub/shared';

import { authApiClient, isApiClientError } from '@/lib/auth/client';

const FATAL_REFRESH_CODES = new Set(['INVALID_REFRESH_TOKEN', 'NO_REFRESH_TOKEN']);

export type CoalescedRefreshResult =
  | { kind: 'success'; user: AuthUser; accessToken: string; expiresIn: number }
  | { kind: 'fatal' }
  | { kind: 'transient' };

function classifyRefreshFailure(err: unknown): 'fatal' | 'transient' {
  if (isApiClientError(err) && err.status === 401 && FATAL_REFRESH_CODES.has(err.code)) {
    return 'fatal';
  }
  return 'transient';
}

let refreshInFlight: Promise<CoalescedRefreshResult> | null = null;

async function runRefreshRequest(): Promise<CoalescedRefreshResult> {
  try {
    const data = await authApiClient.refresh();
    return {
      kind: 'success',
      user: data.user,
      accessToken: data.tokens.accessToken,
      expiresIn: data.tokens.expiresIn,
    };
  } catch (err) {
    return classifyRefreshFailure(err) === 'fatal' ? { kind: 'fatal' } : { kind: 'transient' };
  }
}

/**
 * At most one in-flight POST /api/auth/refresh per tab. Rotation revokes the previous
 * refresh cookie immediately, so concurrent refreshes otherwise produce false logouts.
 */
export function coalescedRefresh(): Promise<CoalescedRefreshResult> {
  if (!refreshInFlight) {
    refreshInFlight = runRefreshRequest().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}
