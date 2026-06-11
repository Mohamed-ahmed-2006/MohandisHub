import { z } from 'zod';

export const adLinkTypeSchema = z.enum(['profile', 'service', 'need']);
export const adStatusSchema = z.enum([
  'pending_payment',
  'active',
  'expired',
  'cancelled',
  'paused_by_admin',
]);

export const createAdSchema = z.object({
  durationDays: z.coerce.number().int().min(1).max(365),
  startsAt: z.string().datetime().optional(),
  titleEn: z.string().trim().min(3).max(180),
  titleAr: z.string().trim().max(180).optional(),
  descriptionEn: z.string().trim().max(800).optional(),
  descriptionAr: z.string().trim().max(800).optional(),
  imageUrl: z.string().trim().min(1).max(2000),
  ctaTextEn: z.string().trim().max(120).optional(),
  ctaTextAr: z.string().trim().max(120).optional(),
  linkType: adLinkTypeSchema,
  linkTarget: z.string().trim().max(2000).optional(),
  priority: z.coerce.number().int().min(0).max(100).optional(),
  targetRoles: z.array(z.string().trim().min(1)).max(10).optional(),
  targetCountries: z.array(z.string().trim().min(1)).max(30).optional(),
  targetCities: z.array(z.string().trim().min(1)).max(50).optional(),
  targetCategories: z.array(z.string().uuid()).max(50).optional(),
  targetLanguages: z.array(z.string().trim().min(1)).max(10).optional(),
  targetMinBudget: z.coerce.number().min(0).optional(),
  targetMaxBudget: z.coerce.number().min(0).optional(),
});

export const updateAdSchema = createAdSchema.partial().extend({
  status: adStatusSchema.optional(),
});

export const listAdsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: adStatusSchema.optional(),
  advertiserId: z.string().uuid().optional(),
});

export const adClickSchema = z.object({});

export const adminScheduleSchema = z.object({
  startsAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const adminPricingOverrideSchema = z.object({
  amount: z.coerce.number().min(0),
});

export const adminAdControlsSchema = z.object({
  acceptAds: z.boolean(),
  pricePerDay: z.coerce.number().min(0),
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
  limit: z.coerce.number().int().min(1).max(20).optional(),
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
