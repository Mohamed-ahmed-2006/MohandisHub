/**
 * localStorage cache for AuthUser to show instant UI before network refresh.
 * Cache is short-lived (5 min) and invalidated on logout.
 */

import type { AuthUser } from '@mohandishub/shared';

const AUTH_USER_CACHE_KEY = 'mohandishub-auth-user';
const AUTH_USER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const authUserCache = {
  get(): AuthUser | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(AUTH_USER_CACHE_KEY);
      if (!raw) return null;
      const { user, ts } = JSON.parse(raw) as { user: AuthUser; ts: number };
      if (Date.now() - ts > AUTH_USER_CACHE_TTL_MS) {
        window.localStorage.removeItem(AUTH_USER_CACHE_KEY);
        return null;
      }
      return user;
    } catch {
      return null;
    }
  },

  set(user: AuthUser): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify({ user, ts: Date.now() }));
    } catch {
      // Ignore quota / privacy errors
    }
  },

  clear(): void {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(AUTH_USER_CACHE_KEY);
  },
};
