import { z } from 'zod';

/**
 * Only `profile` and `service` are offered. `need` was accepted by this schema
 * until weekly billing shipped, but `advertisements_destination_check`
 * (20260727100000) has never been able to store one: it requires either a
 * provider or a service destination. Accepting it produced a raw 23514 rather
 * than a campaign.
 */
export const adLinkTypeSchema = z.enum(['profile', 'service']);

/** The moderation statuses the database CHECK actually permits. */
export const adStatusSchema = z.enum([
  'pending_review',
  'scheduled',
  'active',
  'paused_by_admin',
  'rejected',
  'expired',
  'cancelled',
]);

export const adBillingStatusSchema = z.enum([
  'legacy',
  'pending_review',
  'rejected',
  'awaiting_start',
  'awaiting_credits',
  'active',
  'renewal_required',
  'cancelled',
]);

/**
 * Submission input.
 *
 * `durationDays` is gone: a campaign is sold one seven-day week at a time, so a
 * caller-chosen length has no meaning and no price could be derived from it.
 * `startsAt` remains — a campaign may be approved now and start later.
 *
 * No price field of any kind is accepted. The weekly price is resolved
 * server-side inside the charging transaction.
 */
export const createAdSchema = z
  .object({
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
  })
  // A service campaign must name the service it points at, and it must be an
  // id — the destination is resolved and ownership-checked against it.
  .refine(
    (input) =>
      input.linkType !== 'service' || z.string().uuid().safeParse(input.linkTarget).success,
    {
      message: 'linkTarget must be the id of one of your active services.',
      path: ['linkTarget'],
    },
  );

/**
 * Provider edits. `status` is deliberately ABSENT: it was accepted here, which
 * let an advertiser PUT `{ status: 'active' }` onto their own unreviewed
 * campaign and bypass moderation entirely. Status changes are an admin
 * operation with their own routes.
 */
export const updateAdSchema = z.object({
  titleEn: z.string().trim().min(3).max(180).optional(),
  titleAr: z.string().trim().max(180).optional(),
  descriptionEn: z.string().trim().max(800).optional(),
  descriptionAr: z.string().trim().max(800).optional(),
  imageUrl: z.string().trim().min(1).max(2000).optional(),
  ctaTextEn: z.string().trim().max(120).optional(),
  ctaTextAr: z.string().trim().max(120).optional(),
  linkType: adLinkTypeSchema.optional(),
  linkTarget: z.string().trim().max(2000).optional(),
  startsAt: z.string().datetime().optional(),
  priority: z.coerce.number().int().min(0).max(100).optional(),
  targetRoles: z.array(z.string().trim().min(1)).max(10).optional(),
  targetCountries: z.array(z.string().trim().min(1)).max(30).optional(),
  targetCities: z.array(z.string().trim().min(1)).max(50).optional(),
  targetCategories: z.array(z.string().uuid()).max(50).optional(),
  targetLanguages: z.array(z.string().trim().min(1)).max(10).optional(),
  targetMinBudget: z.coerce.number().min(0).optional(),
  targetMaxBudget: z.coerce.number().min(0).optional(),
});

export const listAdsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: adStatusSchema.optional(),
  billingStatus: adBillingStatusSchema.optional(),
  advertiserId: z.string().uuid().optional(),
});

export const adClickSchema = z.object({});

/** Admin rejection. A reason is mandatory: the advertiser is shown it. */
export const adminRejectSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const adminApproveSchema = z.object({
  /** Optional note recorded alongside the approval. */
  reason: z.string().trim().max(500).optional(),
});

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
  /**
   * MHC charged per advertisement WEEK, written straight to
   * `mhc_action_prices.advertisement`. One period is exactly seven days, so the
   * single-price catalogue expresses a weekly price without a duration
   * dimension.
   */
  mhcPrice: z.coerce.number().min(0),
});

/**
 * Automatic weekly renewal configuration.
 *
 * Three shapes matter and are all expressible:
 *
 *   omitted   — leave whatever is stored;
 *   null      — clear this bound;
 *   a value   — set this bound.
 *
 * That distinction is why the bounds are `.nullable().optional()` rather than
 * merely optional: "stop capping the number of weeks" and "do not change the
 * cap" are different instructions, and collapsing them would silently drop a
 * limit an advertiser set.
 *
 * There is deliberately NO price, amount, period length, period number or
 * balance field. The weekly price is resolved server-side inside the charging
 * transaction, and the period length is a CHECK constraint — neither is
 * something a client is permitted to have an opinion about.
 */
export const autoRenewalSchema = z
  .object({
    enabled: z.boolean(),
    /**
     * Explicit agreement to a standing weekly charge. Required to ENABLE, and
     * meaningless when disabling — turning something off has never needed
     * consent. Enforced again in the service against the locked row, because
     * validation is a convenience and authorisation is not.
     */
    consentAccepted: z.boolean().optional(),
    /** Total weekly periods this campaign may ever buy, INCLUDING the first. */
    maximumWeeks: z.coerce.number().int().min(1).max(520).nullable().optional(),
    /** No period may END after this instant. A partial final week is never sold. */
    renewalEndDate: z.string().datetime().nullable().optional(),
  })
  .refine((input) => !input.enabled || input.consentAccepted === true, {
    message: 'Automatic renewal requires explicit consent.',
    path: ['consentAccepted'],
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

/** One page of a campaign's weeks. Bounded so a caller cannot ask for all of them. */
export const periodHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

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
export type AdminRejectInput = z.infer<typeof adminRejectSchema>;
export type AdminApproveInput = z.infer<typeof adminApproveSchema>;
export type AdminScheduleInput = z.infer<typeof adminScheduleSchema>;
export type AdminPricingOverrideInput = z.infer<typeof adminPricingOverrideSchema>;
export type AdminAdControlsInput = z.infer<typeof adminAdControlsSchema>;
export type AutoRenewalInput = z.infer<typeof autoRenewalSchema>;
export type PeriodHistoryQueryInput = z.infer<typeof periodHistoryQuerySchema>;
export type CreatePricingRuleInput = z.infer<typeof createPricingRuleSchema>;
export type UpdatePricingRuleInput = z.infer<typeof updatePricingRuleSchema>;
export type AdCenterResolveInput = z.infer<typeof adCenterResolveSchema>;
