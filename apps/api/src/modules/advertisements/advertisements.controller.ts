import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { logAudit } from '../audit/audit.service.js';

import { AdvertisementsService } from './advertisements.service.js';
import {
  adCenterResolveSchema,
  adminAdControlsSchema,
  adminApproveSchema,
  adminPricingOverrideSchema,
  adminRejectSchema,
  adminScheduleSchema,
  autoRenewalSchema,
  createAdSchema,
  listAdsQuerySchema,
  updateAdSchema,
} from './advertisements.validation.js';

const svc = new AdvertisementsService();

function requireUser(req: { user?: { id: string; isAdmin?: boolean } }) {
  if (!req.user)
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  return req.user;
}

function requestIp(req: {
  ip?: string | undefined;
  socket?: { remoteAddress?: string | undefined };
}): string | null {
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

function parseBody<T>(
  schema: {
    safeParse: (data: unknown) => {
      success: boolean;
      data?: T;
      error?: { flatten: () => { fieldErrors: unknown } };
    };
  },
  body: unknown,
): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid input.',
      details: result.error!.flatten().fieldErrors,
    });
  }
  return result.data as T;
}

/**
 * Optional, unlike the reservations and jobs controllers which require it.
 * Advertisement creation predates this header, so demanding it would reject
 * every existing client; supplying it is what buys duplicate protection.
 */
function optionalIdempotencyKey(req: {
  header: (name: string) => string | undefined;
}): string | null {
  const key = req.header('Idempotency-Key')?.trim();
  if (!key) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    throw new HttpError({
      statusCode: 400,
      code: 'IDEMPOTENCY_KEY_INVALID',
      message: 'Idempotency-Key must be a UUID.',
    });
  }
  return key;
}

/** Submit a campaign for review. Charges nothing. */
const createAd = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(createAdSchema, req.body);
  const data = await svc.createAd(user.id, input, optionalIdempotencyKey(req));
  res.status(201).json({ ok: true, data });
});

const getAd = asyncHandler(async (req, res) => {
  const data = await svc.getAd(req.params.id!);
  res.json({ ok: true, data });
});

const listMyAds = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const query = parseBody(listAdsQuerySchema, req.query);
  const data = await svc.listMyAds(user.id, query);
  res.json({ ok: true, data });
});

const listAllAds = asyncHandler(async (req, res) => {
  const query = parseBody(listAdsQuerySchema, req.query);
  const data = await svc.listAllAds(query);
  res.json({ ok: true, data });
});

const updateAd = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(updateAdSchema, req.body);
  const data = await svc.updateAd(req.params.id!, user.id, input);
  res.json({ ok: true, data });
});

const deleteAd = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const data = await svc.cancelAd(req.params.id!, user.id);
  res.json({ ok: true, data });
});

/**
 * Weekly billing state for one campaign: what a week costs, which week is
 * running, whether a renewal is owed, and the immutable price snapshot of every
 * week already bought.
 */
const getBillingState = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const data = await svc.getBillingState(req.params.id!, {
    id: user.id,
    isAdmin: user.isAdmin === true,
  });
  res.json({ ok: true, data });
});

/** Buy one more seven-day week. */
const renewAd = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const data = await svc.renewAd(req.params.id!, user.id, optionalIdempotencyKey(req));
  res.json({ ok: true, data });
});

/**
 * Activate an approved campaign whose start is due — the advertiser's retry
 * after topping up credits. Ownership-checked in the service; it can only ever
 * act on a campaign an admin already approved.
 */
const activateAd = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const data = await svc.activateDueAdvertisement(req.params.id!, {
    requireAdvertiserId: user.id,
    actorUserId: user.id,
  });
  res.json({ ok: true, data });
});

/** Always refuses to enable. Automatic renewal has no implementation yet. */
const setAutoRenewal = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(autoRenewalSchema, req.body);
  const data = await svc.setAutoRenewal(req.params.id!, user.id, input);
  res.json({ ok: true, data });
});

const listActiveResolved = asyncHandler(async (req, res) => {
  const input = parseBody(adCenterResolveSchema, req.query);
  const data = await svc.resolveActiveAds(input);
  res.json({ ok: true, data });
});

const trackClick = asyncHandler(async (req, res) => {
  const data = await svc.trackClick(req.params.id!);
  res.json({ ok: true, data });
});

// ---------------------------------------------------------------------------
// Moderation (admin)
// ---------------------------------------------------------------------------

/**
 * Approve a campaign. An immediate campaign is charged for its first week in the
 * same transaction; a future-dated one is charged when its start becomes due.
 */
const adminApprove = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(adminApproveSchema, req.body ?? {});
  const data = await svc.approveAd(req.params.id!, user.id, input.reason ?? null);
  await logAudit({
    actorId: user.id,
    action: 'admin.ad.approve',
    resourceType: 'advertisement',
    resourceId: req.params.id!,
    details: {
      activated: data.period !== null,
      mhcCharged: data.mhcCharged,
      periodId: data.period?.id ?? null,
    },
    ip: requestIp(req),
  });
  res.json({ ok: true, data });
});

/** Reject a campaign. Creates no period and no charge. */
const adminReject = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(adminRejectSchema, req.body);
  const data = await svc.rejectAd(req.params.id!, user.id, input.reason);
  await logAudit({
    actorId: user.id,
    action: 'admin.ad.reject',
    resourceType: 'advertisement',
    resourceId: req.params.id!,
    details: { reason: input.reason },
    ip: requestIp(req),
  });
  res.json({ ok: true, data });
});

/**
 * Activate an approved campaign whose scheduled start has arrived.
 *
 * The deliberate, authorized way to invoke the due-start service while no
 * scheduler exists. It cannot activate an unapproved campaign, and it cannot
 * start one early — both are re-checked inside the transaction.
 */
const adminActivateDue = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const data = await svc.activateDueAdvertisement(req.params.id!, { actorUserId: user.id });
  await logAudit({
    actorId: user.id,
    action: 'admin.ad.activate_due',
    resourceType: 'advertisement',
    resourceId: req.params.id!,
    details: { created: data.created, mhcCharged: data.mhcCharged },
    ip: requestIp(req),
  });
  res.json({ ok: true, data });
});

const adminSetStatus = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = req.body as {
    status?: 'active' | 'paused_by_admin' | 'cancelled';
    reason?: string;
  };
  if (!input.status) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'status is required.',
    });
  }
  const data = await svc.applyAdminStatus(req.params.id!, input.status, input.reason);
  await logAudit({
    actorId: user.id,
    action: 'admin.ad.status',
    resourceType: 'advertisement',
    resourceId: req.params.id!,
    details: { status: input.status, reason: input.reason ?? null },
    ip: requestIp(req),
  });
  res.json({ ok: true, data });
});

const adminSchedule = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(adminScheduleSchema, req.body);
  const data = await svc.applyAdminSchedule(req.params.id!, input);
  await logAudit({
    actorId: user.id,
    action: 'admin.ad.schedule',
    resourceType: 'advertisement',
    resourceId: req.params.id!,
    details: {
      startsAt: input.startsAt ?? null,
      expiresAt: input.expiresAt ?? null,
      reason: input.reason ?? null,
    },
    ip: requestIp(req),
  });
  res.json({ ok: true, data });
});

const adminPricingOverride = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(adminPricingOverrideSchema, req.body);
  const data = await svc.applyAdminPricingOverride(req.params.id!, input);
  await logAudit({
    actorId: user.id,
    action: 'admin.ad.pricing_override',
    resourceType: 'advertisement',
    resourceId: req.params.id!,
    details: { amount: input.amount },
    ip: requestIp(req),
  });
  res.json({ ok: true, data });
});

const getAdControls = asyncHandler(async (_req, res) => {
  const data = await svc.getAdminAdControls();
  res.json({ ok: true, data });
});

const updateAdminAdControls = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(adminAdControlsSchema, req.body);
  const data = await svc.updateAdminAdControls(user.id, input);
  await logAudit({
    actorId: user.id,
    action: 'admin.ad.controls_update',
    resourceType: 'advertisement_controls',
    resourceId: null,
    details: { acceptAds: input.acceptAds, mhcPricePerWeek: input.mhcPrice },
    ip: requestIp(req),
  });
  res.json({ ok: true, data });
});

export const advertisementsController = {
  createAd,
  getAd,
  listMyAds,
  listAllAds,
  updateAd,
  deleteAd,
  getBillingState,
  renewAd,
  activateAd,
  setAutoRenewal,
  listActiveResolved,
  trackClick,
  adminApprove,
  adminReject,
  adminActivateDue,
  adminSetStatus,
  adminSchedule,
  adminPricingOverride,
  getAdControls,
  updateAdminAdControls,
};
