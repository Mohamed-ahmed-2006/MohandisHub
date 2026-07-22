// ---------------------------------------------------------------------------
// Verification controller — HTTP handlers
// ---------------------------------------------------------------------------

import type { ApiSuccessBody, VerificationStatus } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { VerificationService } from './verification.service.js';
import type { WebhookHeaders } from './verification.types.js';

const verificationService = new VerificationService();

// ── POST /api/verification/initiate ──────────────────────────────────────

const initiate = asyncHandler(async (req, res) => {
  const user = req.user;

  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }

  // Contact and expected-identity details are loaded from the authenticated account.
  const result = await verificationService.initiate({
    userId: user.id,
    role: user.role,
  });

  const response: ApiSuccessBody<{
    requestId: string;
    redirectUrl?: string | undefined;
    sessionToken?: string | undefined;
  }> = {
    ok: true,
    data: result,
  };

  res.status(201).json(response);
});

// ── GET /api/verification/status ─────────────────────────────────────────

const getStatus = asyncHandler(async (req, res) => {
  const user = req.user;

  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }

  const result = await verificationService.getStatus(user.id, user.role);

  const response: ApiSuccessBody<{ verificationStatus: VerificationStatus }> = {
    ok: true,
    data: { verificationStatus: result.status },
  };

  res.status(200).json(response);
});

// ── POST /api/verification/webhook ───────────────────────────────────────

const webhook = asyncHandler(async (req, res) => {
  // Webhooks are called by external providers — no auth header.
  // Extract signature headers for Didit verification.
  const headers: WebhookHeaders = {
    signatureV2: req.get('X-Signature-V2') ?? undefined,
    signatureSimple: req.get('X-Signature-Simple') ?? undefined,
    timestamp: req.get('X-Timestamp') ?? undefined,
  };

  await verificationService.handleWebhook(req.body, headers);

  res.status(200).json({ ok: true });
});

export const verificationController = { initiate, getStatus, webhook };
