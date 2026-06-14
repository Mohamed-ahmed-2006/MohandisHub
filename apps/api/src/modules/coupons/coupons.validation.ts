import { z } from 'zod';

export const couponSurfaceSchema = z.enum(['plan', 'service', 'ad', 'platform_fee', 'all']);
export const couponFundingSchema = z.enum(['platform', 'provider', 'split']);
export const couponDiscountTargetSchema = z.enum(['service_price', 'platform_commission', 'both']);

export const couponPreviewSchema = z.object({
  code: z.string().trim().max(50).optional(),
  surface: couponSurfaceSchema,
  subtotal: z.coerce.number().min(0).max(10_000_000),
  commissionAmount: z.coerce.number().min(0).max(10_000_000).default(0).optional(),
  currency: z.string().trim().length(3).default('EGP').optional(),
  providerId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
});

export const couponApplySchema = couponPreviewSchema.extend({
  sourceReference: z.string().trim().max(200).optional(),
});

export const adminCouponSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .transform((v) => v.toUpperCase()),
  type: z.enum(['fixed', 'percent']),
  value: z.coerce.number().positive().max(1_000_000),
  currency: z.string().trim().length(3).default('EGP'),
  targetSurface: couponSurfaceSchema.default('all'),
  discountTarget: couponDiscountTargetSchema.default('service_price'),
  fundingSource: couponFundingSchema.optional(),
  providerSharePercent: z.coerce.number().min(0).max(100).nullable().optional(),
  platformSharePercent: z.coerce.number().min(0).max(100).nullable().optional(),
  minSpend: z.coerce.number().min(0).nullable().optional(),
  maxDiscount: z.coerce.number().min(0).nullable().optional(),
  maxUses: z.coerce.number().int().positive().nullable().optional(),
  maxUsesPerUser: z.coerce.number().int().positive().nullable().optional(),
  allowedRoles: z
    .array(z.enum(['customer', 'expert', 'business', 'admin', 'craftsman']))
    .default([]),
  active: z.boolean().default(false),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().nullable().optional(),
});

export const adminCouponUpdateSchema = adminCouponSchema.partial().extend({
  active: z.boolean().optional(),
});

export const providerCouponCampaignSchema = couponPreviewSchema.extend({
  code: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .transform((v) => v.toUpperCase()),
  type: z.enum(['fixed', 'percent']),
  value: z.coerce.number().positive().max(1_000_000),
  discountTarget: couponDiscountTargetSchema,
  requestedQuantity: z.coerce.number().int().positive().max(100_000),
  maxUsesPerUser: z.coerce.number().int().positive().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
});

export const adminCampaignDecisionSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
});

export type CouponPreviewInput = z.infer<typeof couponPreviewSchema>;
export type CouponApplyInput = z.infer<typeof couponApplySchema>;
export type AdminCouponInput = z.infer<typeof adminCouponSchema>;
export type AdminCouponUpdateInput = z.infer<typeof adminCouponUpdateSchema>;
export type ProviderCouponCampaignInput = z.infer<typeof providerCouponCampaignSchema>;
