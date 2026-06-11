import type { AuthUser } from '@mohandishub/shared';

import { authUserCache } from '@/lib/auth/auth-cache';
import { coalescedRefresh } from '@/lib/auth/refresh-coalesced';
import { sessionStore } from '@/lib/auth/session-store';

export const AUTH_SESSION_REFRESHED_EVENT = 'mohandishub-session-refreshed';

export type AuthSessionRefreshedEventDetail =
  | { kind: 'success'; user: AuthUser; accessToken: string; expiresIn: number }
  | { kind: 'fatal' };

function emitAuthSessionRefreshed(detail: AuthSessionRefreshedEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_REFRESHED_EVENT, { detail }));
}

function withBearer(headers: HeadersInit | undefined, accessToken: string): Headers {
  const next = new Headers(headers);
  next.set('Authorization', `Bearer ${accessToken}`);
  return next;
}

export function bearerTokenFromHeaders(headers: HeadersInit | undefined): string | null {
  const authorization = new Headers(headers).get('Authorization');
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export async function fetchWithAuthRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  accessToken: string | null | undefined,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 401 || !accessToken) {
    return response;
  }

  const refreshed = await coalescedRefresh();
  if (refreshed.kind !== 'success') {
    if (refreshed.kind === 'fatal') {
      sessionStore.clear();
      authUserCache.clear();
      emitAuthSessionRefreshed({ kind: 'fatal' });
    }
    return response;
  }

  sessionStore.setAccessToken(refreshed.accessToken);
  authUserCache.set(refreshed.user);
  emitAuthSessionRefreshed({
    kind: 'success',
    user: refreshed.user,
    accessToken: refreshed.accessToken,
    expiresIn: refreshed.expiresIn,
  });

  return fetch(input, {
    ...init,
    headers: withBearer(init.headers, refreshed.accessToken),
  });
}
