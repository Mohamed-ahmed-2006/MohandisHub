import rateLimit from 'express-rate-limit';

import { env } from '../config/env.js';

const DEFAULT_API_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_AUTH_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

const API_WINDOW_MS = env.API_RATE_LIMIT_WINDOW_MS ?? DEFAULT_API_WINDOW_MS;
const API_MAX = env.API_RATE_LIMIT_MAX ?? 5000;
const AUTH_WINDOW_MS = env.AUTH_RATE_LIMIT_WINDOW_MS ?? DEFAULT_AUTH_WINDOW_MS;
const AUTH_MAX = env.AUTH_RATE_LIMIT_MAX ?? 2000;

/**
 * General API rate limit per IP (default: 5000 / 15 min). Override with API_RATE_LIMIT_* env.
 */
export const apiRateLimiter = rateLimit({
  windowMs: API_WINDOW_MS,
  max: API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Broad limit for non-sensitive /auth and /otp traffic per IP (refresh, logout,
 * me) which is called frequently by normal UI usage (default: 2000 / 10 min).
 * Override with AUTH_RATE_LIMIT_* env.
 */
export const authRateLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Strict limiter for credential submission (login). Protects against password
 * spraying / credential stuffing. Default: 10 attempts / 15 min / IP.
 */
export const loginRateLimiter = rateLimit({
  windowMs: FIFTEEN_MIN_MS,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

/**
 * Strict limiter for account creation. Default: 5 / hour / IP.
 */
export const registerRateLimiter = rateLimit({
  windowMs: ONE_HOUR_MS,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Strict limiter for password-reset request/confirm. Default: 5 / hour / IP.
 */
export const passwordResetRateLimiter = rateLimit({
  windowMs: ONE_HOUR_MS,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Strict limiter for OTP send/verify to throttle code guessing and email/SMS
 * spam. Default: 10 / 15 min / IP.
 */
export const otpRateLimiter = rateLimit({
  windowMs: FIFTEEN_MIN_MS,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Limiter for the unauthenticated business-team invitation preview.
 *
 * The token itself is 256 bits, so this is not what makes guessing infeasible —
 * it is what stops the endpoint being used as a free oracle at volume. Sized for
 * a real recipient, who loads the page a handful of times at most.
 */
export const invitePreviewRateLimiter = rateLimit({
  windowMs: FIFTEEN_MIN_MS,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
