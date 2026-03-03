// ---------------------------------------------------------------------------
// OTP controller — HTTP request handlers
// ---------------------------------------------------------------------------

import type { ApiSuccessBody, SendOtpResult, VerifyOtpResult } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { OtpService } from './otp.service.js';
import { sendOtpSchema, verifyOtpSchema } from './otp.validation.js';

const otpService = new OtpService();

// ── POST /api/otp/send ─────────────────────────────────────────────────

const send = asyncHandler(async (req, res) => {
  const user = req.user;

  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }

  const parsed = sendOtpSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request.',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await otpService.sendCode(user.id, parsed.data.channel);

  const response: ApiSuccessBody<SendOtpResult> = {
    ok: true,
    data: result,
  };

  res.status(200).json(response);
});

// ── POST /api/otp/verify ───────────────────────────────────────────────

const verify = asyncHandler(async (req, res) => {
  const user = req.user;

  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }

  const parsed = verifyOtpSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request.',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await otpService.verifyCode(user.id, parsed.data.channel, parsed.data.code);

  const response: ApiSuccessBody<VerifyOtpResult> = {
    ok: true,
    data: result,
  };

  res.status(200).json(response);
});

export const otpController = { send, verify };
