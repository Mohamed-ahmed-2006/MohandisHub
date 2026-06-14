import type { ApiSuccessBody } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { CouponsService } from './coupons.service.js';
import {
  adminCampaignDecisionSchema,
  adminCouponSchema,
  adminCouponUpdateSchema,
  couponApplySchema,
  couponPreviewSchema,
  providerCouponCampaignSchema,
} from './coupons.validation.js';

const couponsService = new CouponsService();

function requireUser(req: { user?: { id: string; role?: string } }) {
  if (!req.user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.user;
}

const parseOrThrow = <T>(
  schema: {
    safeParse: (value: unknown) => {
      success: boolean;
      data?: T;
      error?: { flatten: () => { fieldErrors: unknown } };
    };
  },
  value: unknown,
  message: string,
): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message,
      details: parsed.error?.flatten().fieldErrors,
    });
  }
  return parsed.data as T;
};

export const validateCoupon = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseOrThrow(couponPreviewSchema, req.body, 'Invalid coupon preview input.');
  const data = await couponsService.preview(input, user);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const applyCoupon = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseOrThrow(couponApplySchema, req.body, 'Invalid coupon apply input.');
  const data = await couponsService.apply(input, user);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.status(201).json(response);
});

export const previewProviderCampaign = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseOrThrow(
    providerCouponCampaignSchema.pick({ requestedQuantity: true }),
    req.body,
    'Invalid campaign preview input.',
  );
  const data = await couponsService.previewProviderCampaign(user, input);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const createProviderCampaign = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseOrThrow(
    providerCouponCampaignSchema,
    req.body,
    'Invalid campaign request input.',
  );
  const data = await couponsService.createProviderCampaign(user, input);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.status(201).json(response);
});

export const listMyCampaigns = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const data = await couponsService.listMyCampaigns(user);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const listAdminCoupons = asyncHandler(async (_req, res) => {
  const data = await couponsService.listAdmin();
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const createAdminCoupon = asyncHandler(async (req, res) => {
  const input = parseOrThrow(adminCouponSchema, req.body, 'Invalid coupon input.');
  const data = await couponsService.createAdmin(input);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.status(201).json(response);
});

export const updateAdminCoupon = asyncHandler(async (req, res) => {
  const input = parseOrThrow(adminCouponUpdateSchema, req.body, 'Invalid coupon input.');
  const data = await couponsService.updateAdmin(req.params.id!, input);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const listAdminCampaigns = asyncHandler(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const data = await couponsService.listAdminCampaigns(status);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const approveCampaign = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseOrThrow(adminCampaignDecisionSchema, req.body, 'Reason is required.');
  const data = await couponsService.approveCampaign(req.params.id!, user.id, input.reason);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const rejectCampaign = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseOrThrow(adminCampaignDecisionSchema, req.body, 'Reason is required.');
  const data = await couponsService.rejectCampaign(req.params.id!, user.id, input.reason);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const couponsController = {
  validateCoupon,
  applyCoupon,
  previewProviderCampaign,
  createProviderCampaign,
  listMyCampaigns,
  listAdminCoupons,
  createAdminCoupon,
  updateAdminCoupon,
  listAdminCampaigns,
  approveCampaign,
  rejectCampaign,
};
