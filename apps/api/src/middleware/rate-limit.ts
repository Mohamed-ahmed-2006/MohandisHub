import rateLimit from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * General API rate limit: 100 requests per 15 minutes per IP.
 */
export const apiRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Stricter limit for auth and OTP: 20 requests per 15 minutes per IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
