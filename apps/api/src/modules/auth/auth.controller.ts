// ---------------------------------------------------------------------------
// Auth controller — HTTP request handlers
// ---------------------------------------------------------------------------

import type { ApiSuccessBody, AuthTokens, AuthUser } from '@mohandishub/shared';

import { clearRefreshCookie, getRefreshCookie, setRefreshCookie } from '../../config/cookies.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { AuthService } from './auth.service.js';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from './auth.validation.js';

const authService = new AuthService();

// ── POST /api/auth/register ─────────────────────────────────────────────

const register = asyncHandler(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid registration data.',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await authService.register(parsed.data, {
    deviceInfo: req.headers['user-agent'],
    ipAddress: req.ip,
  });

  setRefreshCookie(res, result.refreshToken);

  const response: ApiSuccessBody<{ user: AuthUser; tokens: AuthTokens }> = {
    ok: true,
    data: { user: result.user, tokens: result.tokens },
  };

  res.status(201).json(response);
});

// ── POST /api/auth/login ────────────────────────────────────────────────

const login = asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid login data.',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await authService.login(parsed.data, {
    deviceInfo: req.headers['user-agent'],
    ipAddress: req.ip,
  });

  setRefreshCookie(res, result.refreshToken);

  const response: ApiSuccessBody<{ user: AuthUser; tokens: AuthTokens }> = {
    ok: true,
    data: { user: result.user, tokens: result.tokens },
  };

  res.status(200).json(response);
});

const forgotPassword = asyncHandler(async (req, res) => {
  // #region agent log
  fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '8fd58e' },
    body: JSON.stringify({
      sessionId: '8fd58e',
      location: 'auth.controller.ts:forgotPassword:entry',
      message: 'forgotPassword controller reached',
      data: { hasBody: !!req.body, bodyKeys: req.body ? Object.keys(req.body) : [] },
      timestamp: Date.now(),
      hypothesisId: 'H1',
    }),
  }).catch(() => {});
  // #endregion

  const parsed = forgotPasswordSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid forgot-password data.',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  // #region agent log
  fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '8fd58e' },
    body: JSON.stringify({
      sessionId: '8fd58e',
      location: 'auth.controller.ts:forgotPassword:beforeService',
      message: 'validation passed, calling authService.forgotPassword',
      data: { email: parsed.data.email?.slice?.(0, 3) + '***' },
      timestamp: Date.now(),
      hypothesisId: 'H2',
    }),
  }).catch(() => {});
  // #endregion

  const result = await authService.forgotPassword(parsed.data);

  // #region agent log
  fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '8fd58e' },
    body: JSON.stringify({
      sessionId: '8fd58e',
      location: 'auth.controller.ts:forgotPassword:afterService',
      message: 'authService.forgotPassword returned',
      data: { hasMessage: !!result?.message },
      timestamp: Date.now(),
      hypothesisId: 'H2,H3',
    }),
  }).catch(() => {});
  // #endregion

  const response: ApiSuccessBody<typeof result> = {
    ok: true,
    data: result,
  };

  res.status(200).json(response);
});

const resetPassword = asyncHandler(async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid reset-password data.',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await authService.resetPassword(parsed.data);
  const response: ApiSuccessBody<typeof result> = {
    ok: true,
    data: result,
  };

  res.status(200).json(response);
});

// ── POST /api/auth/refresh ──────────────────────────────────────────────

const refresh = asyncHandler(async (req, res) => {
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
  const rawToken = getRefreshCookie(cookies);

  if (!rawToken) {
    throw new HttpError({
      statusCode: 401,
      code: 'NO_REFRESH_TOKEN',
      message: 'Refresh token cookie not found.',
    });
  }

  const result = await authService.refresh(rawToken, {
    deviceInfo: req.headers['user-agent'],
    ipAddress: req.ip,
  });

  setRefreshCookie(res, result.newRefreshToken);

  const response: ApiSuccessBody<{ user: AuthUser; tokens: AuthTokens }> = {
    ok: true,
    data: { user: result.user, tokens: result.tokens },
  };

  res.status(200).json(response);
});

// ── POST /api/auth/logout ───────────────────────────────────────────────

const logout = asyncHandler(async (req, res) => {
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
  const rawToken = getRefreshCookie(cookies);

  if (rawToken) {
    await authService.logout(rawToken);
  }

  clearRefreshCookie(res);

  const response: ApiSuccessBody<{ message: string }> = {
    ok: true,
    data: { message: 'Logged out successfully.' },
  };

  res.status(200).json(response);
});

// ── GET /api/auth/me ────────────────────────────────────────────────────

const me = asyncHandler(async (req, res) => {
  const user = req.user;

  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }

  const authUser = await authService.getMe(user.id);

  const response: ApiSuccessBody<AuthUser> = {
    ok: true,
    data: authUser,
  };

  res.status(200).json(response);
});

export const authController = {
  register,
  login,
  forgotPassword,
  resetPassword,
  refresh,
  logout,
  me,
};
