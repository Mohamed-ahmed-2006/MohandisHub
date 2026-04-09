import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { AdvertisementsService } from './advertisements.service.js';
import {
  adCenterResolveSchema,
  adminAdControlsSchema,
  adminPricingOverrideSchema,
  adminScheduleSchema,
  createAdSchema,
  listAdsQuerySchema,
  updateAdSchema,
} from './advertisements.validation.js';

const svc = new AdvertisementsService();

function requireUser(req: { user?: { id: string } }) {
  if (!req.user) throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  return req.user;
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
  const data = await svc.resolveActiveAds(input);
  res.json({ ok: true, data });
});

const trackClick = asyncHandler(async (req, res) => {
  const data = await svc.trackClick(req.params.id!);
  res.json({ ok: true, data });
});

const adminSetStatus = asyncHandler(async (req, res) => {
  const input = req.body as { status?: 'active' | 'paused_by_admin' | 'cancelled'; reason?: string };
  if (!input.status) {
    throw new HttpError({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'status is required.' });
  }
  const data = await svc.applyAdminStatus(req.params.id!, input.status, input.reason);
  res.json({ ok: true, data });
});

const adminSchedule = asyncHandler(async (req, res) => {
  const input = parseBody(adminScheduleSchema, req.body);
  const data = await svc.applyAdminSchedule(req.params.id!, input);
  res.json({ ok: true, data });
});

const adminPricingOverride = asyncHandler(async (req, res) => {
  const input = parseBody(adminPricingOverrideSchema, req.body);
  const data = await svc.applyAdminPricingOverride(req.params.id!, input);
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
  res.json({ ok: true, data });
});

export const advertisementsController = {
  createAd,
  getAd,
  listMyAds,
  listAllAds,
  updateAd,
  deleteAd,
  listActiveResolved,
  trackClick,
  adminSetStatus,
  adminSchedule,
  adminPricingOverride,
  getAdControls,
  updateAdminAdControls,
};
