import type { Response } from 'express';

import { env } from './env.js';

const REFRESH_COOKIE_NAME = 'rid';
const isProduction = env.NODE_ENV === 'production';

export const setRefreshCookie = (res: Response, token: string): void => {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: env.JWT_REFRESH_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
  });
};

export const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/auth',
  });
};

export const getRefreshCookie = (cookies: Record<string, string | undefined>): string | undefined =>
  cookies[REFRESH_COOKIE_NAME];
