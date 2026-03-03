// ---------------------------------------------------------------------------
// Cookie helpers — httpOnly refresh-token cookie
// ---------------------------------------------------------------------------

import type { Response } from 'express';

import { env } from './env.js';

const REFRESH_COOKIE_NAME = 'rid'; // short name to reduce header size

export const setRefreshCookie = (res: Response, token: string): void => {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth', // only sent to auth endpoints
    maxAge: env.JWT_REFRESH_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
  });
};

export const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
  });
};

export const getRefreshCookie = (cookies: Record<string, string | undefined>): string | undefined =>
  cookies[REFRESH_COOKIE_NAME];
