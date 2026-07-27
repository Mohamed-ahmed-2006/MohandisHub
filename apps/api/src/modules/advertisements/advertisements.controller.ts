import { createHmac } from 'node:crypto';

import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { logAudit } from '../audit/audit.service.js';

import { AdvertisementsService } from './advertisements.service.js';
import {
  adCenterResolveSchema,
  adDeliveryEventSchema,
  adQuoteQuerySchema,
  adminAdControlsSchema,
  adminReviewSchema,
  adminScheduleSchema,
  adminStatusSchema,
  createAdSchema,
  listAdsQuerySchema,
  updateAdSchema,
} from './advertisements.validation.js';

const svc = new AdvertisementsService();

function requireUser(req: { user?: { id: string } }) {
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

function viewerHash(req: {
  user?: { id: string };
  ip?: string | undefined;
  socket?: { remoteAddress?: string | undefined };
  get: (name: string) => string | undefined;
}): string {
  const value = `${req.user?.id ?? 'anonymous'}|${requestIp(req) ?? 'unknown'}|${
    req.get('user-agent') ?? 'unknown'
  }`;
  return createHmac('sha256', env.JWT_SECRET).update(value).digest('hex');
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

const createAd = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(createAdSchema, req.body);
  const data = await svc.createAd(user.id, input);
  res.status(201).json({ ok: true, data });
});

const quoteAd = asyncHandler(async (req, res) => {
  const input = parseBody(adQuoteQuerySchema, req.query);
  const data = await svc.quote(input.durationDays);
  res.json({ ok: true, data });
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

const listActiveResolved = asyncHandler(async (req, res) => {
  const input = parseBody(adCenterResolveSchema, req.query);
  const data = await svc.resolveActiveAds(input, viewerHash(req));
  res.json({ ok: true, data });
});

const trackImpression = asyncHandler(async (req, res) => {
  const input = parseBody(adDeliveryEventSchema, req.body);
  const data = await svc.trackImpression(req.params.id!, input.deliveryToken, viewerHash(req));
  res.json({ ok: true, data });
});

const trackClick = asyncHandler(async (req, res) => {
  const input = parseBody(adDeliveryEventSchema, req.body);
  const data = await svc.trackClick(req.params.id!, input.deliveryToken, viewerHash(req));
  res.json({ ok: true, data });
});

const adminReview = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(adminReviewSchema, req.body);
  const data = await svc.reviewAd(req.params.id!, user.id, input);
  await logAudit({
    actorId: user.id,
    action: `admin.ad.${input.decision}`,
    resourceType: 'advertisement',
    resourceId: req.params.id!,
    details: { decision: input.decision, reason: input.reason ?? null },
    ip: requestIp(req),
  });
  res.json({ ok: true, data });
});

const adminSetStatus = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(adminStatusSchema, req.body);
  const data = await svc.applyAdminStatus(req.params.id!, user.id, input.status, input.reason);
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
    details: { acceptAds: input.acceptAds, pricePerDay: input.pricePerDay },
    ip: requestIp(req),
  });
  res.json({ ok: true, data });
});

export const advertisementsController = {
  createAd,
  quoteAd,
  getAd,
  listMyAds,
  listAllAds,
  updateAd,
  deleteAd,
  listActiveResolved,
  trackImpression,
  trackClick,
  adminReview,
  adminSetStatus,
  adminSchedule,
  getAdControls,
  updateAdminAdControls,
};
