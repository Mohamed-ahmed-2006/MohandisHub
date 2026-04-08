import type { Response } from 'express';

import { env } from './env.js';

const REFRESH_COOKIE_NAME = 'rid';

const useCrossSiteRefreshCookie =
  env.NODE_ENV === 'production' || env.AUTH_CROSS_SITE_REFRESH_COOKIE;

/**
 * Production API is often called from another origin (e.g. https://www.mohandishub.app or
 * http://localhost:3000 with NEXT_PUBLIC_API_URL pointing at the deployed API).
 * SameSite=Lax does not send cookies on cross-site POST, so refresh always 401s.
 * SameSite=None + Secure allows credentialed fetch (credentials: 'include') from those origins.
 */
const refreshCookieSameSite: 'lax' | 'none' = useCrossSiteRefreshCookie ? 'none' : 'lax';
const refreshCookieSecure = useCrossSiteRefreshCookie;

export const setRefreshCookie = (res: Response, token: string): void => {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: refreshCookieSecure,
    sameSite: refreshCookieSameSite,
    path: '/api/auth',
    maxAge: env.JWT_REFRESH_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
  });
};

export const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: refreshCookieSecure,
    sameSite: refreshCookieSameSite,
    path: '/api/auth',
  });
};

export const getRefreshCookie = (cookies: Record<string, string | undefined>): string | undefined =>
  cookies[REFRESH_COOKIE_NAME];
