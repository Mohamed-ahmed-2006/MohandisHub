// ---------------------------------------------------------------------------
// Auth controller — HTTP request handlers
// ---------------------------------------------------------------------------

import type { ApiSuccessBody, AuthTokens, AuthUser } from '@mohandishub/shared';

import { clearRefreshCookie, getRefreshCookie, setRefreshCookie } from '../../config/cookies.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { AuthService } from './auth.service.js';
import { loginSchema, registerSchema } from './auth.validation.js';

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

export const authController = { register, login, refresh, logout, me };
