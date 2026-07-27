import { z } from 'zod';

export const adLinkTypeSchema = z.enum(['profile', 'service']);
export const adStatusSchema = z.enum([
  'pending_review',
  'scheduled',
  'active',
  'paused_by_admin',
  'rejected',
  'expired',
  'cancelled',
]);

export const createAdSchema = z
  .object({
    durationDays: z.number().int().min(1).max(365),
    startsAt: z.string().datetime().optional(),
    titleEn: z.string().trim().min(3).max(180),
    titleAr: z.string().trim().max(180).optional(),
    descriptionEn: z.string().trim().max(800).optional(),
    descriptionAr: z.string().trim().max(800).optional(),
    imageUrl: z.string().trim().min(1).max(2000),
    bannerUploadId: z.string().uuid(),
    ctaTextEn: z.string().trim().max(120).optional(),
    ctaTextAr: z.string().trim().max(120).optional(),
    linkType: adLinkTypeSchema,
    linkTarget: z.string().uuid().optional(),
    targetRoles: z.array(z.string().trim().min(1)).max(10).optional(),
    targetCountries: z.array(z.string().trim().min(1)).max(30).optional(),
    targetCities: z.array(z.string().trim().min(1)).max(50).optional(),
    targetCategories: z.array(z.string().uuid()).max(50).optional(),
    targetLanguages: z.array(z.string().trim().min(1)).max(10).optional(),
    targetMinBudget: z.number().min(0).optional(),
    targetMaxBudget: z.number().min(0).optional(),
  })
  .strict();

export const updateAdSchema = createAdSchema
  .omit({ durationDays: true, startsAt: true, linkType: true, linkTarget: true })
  .partial();

const strictPositiveInteger = (defaultValue: number, max: number) =>
  z.preprocess(
    (value) => (value === undefined ? String(defaultValue) : value),
    z
      .string()
      .regex(/^[1-9]\d*$/)
      .transform(Number)
      .refine((value) => Number.isSafeInteger(value) && value <= max),
  );

export const listAdsQuerySchema = z.object({
  page: strictPositiveInteger(1, 1_000_000),
  limit: strictPositiveInteger(20, 100),
  status: adStatusSchema.optional(),
  advertiserId: z.string().uuid().optional(),
});

export const adDeliveryEventSchema = z.object({
  deliveryToken: z.string().min(20).max(4000),
});

export const adQuoteQuerySchema = z.object({
  durationDays: strictPositiveInteger(1, 365),
});

export const adminReviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(3).max(500).optional(),
});

export const adminStatusSchema = z.object({
  status: z.enum(['active', 'paused_by_admin', 'cancelled']),
  reason: z.string().trim().min(3).max(500).optional(),
});

export const adminScheduleSchema = z.object({
  startsAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const adminPricingOverrideSchema = z.object({
  amount: z.number().min(0),
});

export const adminAdControlsSchema = z.object({
  acceptAds: z.boolean(),
  pricePerDay: z
    .number()
    .min(0)
    .refine((value) => Number.isSafeInteger(value * 100), 'Use at most two decimal places.'),
});

export const createPricingRuleSchema = z.object({
  name: z.string().trim().min(2).max(200),
  isActive: z.boolean().optional(),
  roleScope: z.array(z.string().trim()).optional(),
  countryScope: z.array(z.string().trim()).optional(),
  cityScope: z.array(z.string().trim()).optional(),
  categoryScope: z.array(z.string().uuid()).optional(),
  minDurationDays: z.coerce.number().int().min(1).optional(),
  maxDurationDays: z.coerce.number().int().min(1).optional(),
  priceMultiplier: z.coerce.number().min(0).max(100).optional(),
  flatFee: z.coerce.number().min(0).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  priority: z.coerce.number().int().min(0).max(1000).optional(),
});

export const updatePricingRuleSchema = createPricingRuleSchema.partial();

export const adCenterResolveSchema = z.object({
  locale: z.string().trim().optional(),
  city: z.string().trim().optional(),
  country: z.string().trim().optional(),
  role: z.string().trim().optional(),
  categories: z.array(z.string().uuid()).optional(),
  budget: z.coerce.number().min(0).optional(),
  limit: strictPositiveInteger(5, 20).optional(),
});

export type CreateAdInput = z.infer<typeof createAdSchema>;
export type UpdateAdInput = z.infer<typeof updateAdSchema>;
export type ListAdsQueryInput = z.infer<typeof listAdsQuerySchema>;
export type AdminScheduleInput = z.infer<typeof adminScheduleSchema>;
export type AdminPricingOverrideInput = z.infer<typeof adminPricingOverrideSchema>;
export type AdminAdControlsInput = z.infer<typeof adminAdControlsSchema>;
export type CreatePricingRuleInput = z.infer<typeof createPricingRuleSchema>;
export type UpdatePricingRuleInput = z.infer<typeof updatePricingRuleSchema>;
export type AdCenterResolveInput = z.infer<typeof adCenterResolveSchema>;
export type AdminReviewInput = z.infer<typeof adminReviewSchema>;
