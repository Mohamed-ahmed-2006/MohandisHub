import rateLimit from 'express-rate-limit';

import { env } from '../config/env.js';

const DEFAULT_API_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_AUTH_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

const API_WINDOW_MS = env.API_RATE_LIMIT_WINDOW_MS ?? DEFAULT_API_WINDOW_MS;
const API_MAX = env.API_RATE_LIMIT_MAX ?? 100;
const AUTH_WINDOW_MS = env.AUTH_RATE_LIMIT_WINDOW_MS ?? DEFAULT_AUTH_WINDOW_MS;
const AUTH_MAX = env.AUTH_RATE_LIMIT_MAX ?? 30;

/**
 * General API rate limit per IP (default: 100 / 15 min). Override with API_RATE_LIMIT_* env.
 */
export const apiRateLimiter = rateLimit({
  windowMs: API_WINDOW_MS,
  max: API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Stricter limit for /auth and /otp per IP (default: 30 / 10 min). Override with AUTH_RATE_LIMIT_* env.
 */
export const authRateLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});
