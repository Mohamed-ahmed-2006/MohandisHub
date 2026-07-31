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
  periodHistoryQuerySchema,
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

/**
 * Turn automatic weekly renewal on or off, or change its bounds.
 *
 * Charges nothing and never touches the running week. Ownership and consent are
 * re-checked in the service, inside the transaction that locks the campaign —
 * not here, where a check would race the write.
 */
const setAutoRenewal = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(autoRenewalSchema, req.body);
  const before = await svc.getAutoRenewalState(req.params.id!, { id: user.id, isAdmin: false });
  const data = await svc.setAutoRenewal(req.params.id!, user.id, input);
  // Consent to a standing weekly charge is worth an audit row. Only a real
  // transition is recorded, so re-submitting the same settings does not fill
  // the log with non-events.
  if (before.autoRenewEnabled !== data.autoRenewEnabled) {
    await logAudit({
      actorId: user.id,
      action: data.autoRenewEnabled ? 'ad.auto_renewal.enable' : 'ad.auto_renewal.disable',
      resourceType: 'advertisement',
      resourceId: req.params.id!,
      details: {
        maximumWeeks: data.maximumWeeks,
        renewalEndDate: data.renewalEndDate,
        consentVersion: data.autoRenewEnabled ? data.autoRenewConsentVersion : null,
      },
      ip: requestIp(req),
    });
  }
  res.json({ ok: true, data });
});

/**
 * Try a paused automatic renewal again, at the advertiser's explicit request.
 *
 * The supported way out of "not enough credits": top up, then press this. It
 * runs the SAME locked, exactly-once operation the scheduler runs, so pressing
 * it twice, or pressing it while the scheduler acts, cannot buy two weeks.
 *
 * The outcome is mapped to HTTP rather than thrown from the service, because
 * "paused again for the same reason" is a real answer with a real remedy, not
 * an exception.
 */
const retryAutoRenewal = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const result = await svc.retryAutomaticRenewal(req.params.id!, user.id);

  if (result.outcome === 'renewed') {
    res.json({
      ok: true,
      data: {
        renewed: true,
        mhcCharged: result.mhcCharged,
        periodNumber: result.period.period_number,
        periodEndsAt: result.period.ends_at,
      },
    });
    return;
  }

  if (result.outcome === 'paused') {
    const paused = {
      insufficient_credits: {
        statusCode: 402,
        code: 'MHC_INSUFFICIENT_CREDITS',
        message: 'You do not have enough credits for another advertisement week.',
      },
      pricing_unavailable: {
        statusCode: 503,
        code: 'MHC_ACTION_PRICE_MISSING',
        message: 'Advertisement pricing is unavailable, so no week could be bought.',
      },
      max_weeks_reached: {
        statusCode: 409,
        code: 'AD_RENEWAL_LIMIT_REACHED',
        message: 'This campaign has reached its configured maximum number of weeks.',
      },
      end_date_reached: {
        statusCode: 409,
        code: 'AD_RENEWAL_WINDOW_CLOSED',
        message: 'A full week would run past this campaign’s configured end date.',
      },
    }[result.reason];
    throw new HttpError({
      statusCode: paused.statusCode,
      code: paused.code,
      message: paused.message,
      details: { reason: result.reason, requiredMhc: result.requiredMhc },
    });
  }

  // Skipped: the campaign is not in a state a retry can act on. Reported as one
  // stable code with the specific reason attached, so a client can explain it
  // without guessing from a message string.
  throw new HttpError({
    statusCode: 409,
    code: 'AD_RENEWAL_NOT_ELIGIBLE',
    message: 'This advertisement is not waiting for an automatic renewal.',
    details: { reason: result.reason },
  });
});

/** The campaign's automatic-renewal configuration and consent record. */
const getAutoRenewalState = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const data = await svc.getAutoRenewalState(req.params.id!, {
    id: user.id,
    isAdmin: user.isAdmin === true,
  });
  res.json({ ok: true, data });
});

/**
 * One page of this campaign's weeks, with the immutable price snapshot of each.
 *
 * Ownership is enforced in the service against the stored advertiser id.
 */
const listPeriodHistory = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const query = parseBody(periodHistoryQuerySchema, req.query);
  const data = await svc.listPeriodHistory(
    req.params.id!,
    { id: user.id, isAdmin: user.isAdmin === true },
    query,
  );
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
  retryAutoRenewal,
  getAutoRenewalState,
  listPeriodHistory,
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
