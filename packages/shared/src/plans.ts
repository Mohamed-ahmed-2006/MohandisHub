// ---------------------------------------------------------------------------
// Plan types — shared between API and frontend
// ---------------------------------------------------------------------------

/** Roles that can subscribe to a paid plan (excludes admin). */
export const PLAN_SUBSCRIBER_ROLES = ['customer', 'expert', 'business', 'craftsman'] as const;
export type PlanSubscriberRole = (typeof PLAN_SUBSCRIBER_ROLES)[number];

export const DEFAULT_PLAN_ALLOWED_ROLES: PlanSubscriberRole[] = [
  'customer',
  'expert',
  'business',
  'craftsman',
];

const SUBSCRIBER_ROLE_SET = new Set<string>(PLAN_SUBSCRIBER_ROLES);

/** Normalize DB/API values to a non-empty list of subscriber roles. */
export function normalizePlanAllowedRoles(raw: unknown): PlanSubscriberRole[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_PLAN_ALLOWED_ROLES];
  const out = raw.filter(
    (r): r is PlanSubscriberRole =>
      typeof r === 'string' && SUBSCRIBER_ROLE_SET.has(r as PlanSubscriberRole),
  );
  return out.length > 0 ? out : [...DEFAULT_PLAN_ALLOWED_ROLES];
}

export type BillingCycle = 'monthly' | 'quarterly' | 'yearly' | 'one_time';

/** Bids visibility for customer when viewing bids on a need. */
export type BidsVisibleToCustomer = 'all' | 'top_n' | 'premium_first' | 'priority_first';

/** Metered actions: max uses per window (distinct from concurrent inventory caps). */
export const USAGE_QUOTA_FEATURE_KEYS = [
  'new_needs_per_period',
  'new_services_per_period',
  'new_bids_per_period',
  'new_jobs_per_period',
] as const;
export type UsageQuotaFeatureKey = (typeof USAGE_QUOTA_FEATURE_KEYS)[number];

/** `billing_cycle` uses the active subscription window, or calendar month if none. */
export type UsageQuotaPeriodType = 'billing_cycle' | 'calendar_month';

export type PlanUsageQuotaDef = {
  maxPerPeriod: number;
  period: UsageQuotaPeriodType;
};

/** Structured limits and feature flags per plan (enforced by API). */
export type PlanLimits = {
  // —— For customers (posting needs) ——
  /** Max active needs a customer can have. */
  maxNeeds?: number | null;
  /** How many bids the customer sees on a need: all, top_n, or premium_first. */
  bidsVisibleToCustomer?: BidsVisibleToCustomer | null;
  /** When bidsVisibleToCustomer is 'top_n', show only this many bids (default 3). */
  bidsVisibleTopN?: number | null;
  /** Max bids per need (e.g. 10 = customer gets max 10 bids per need). */
  maxBidsPerNeed?: number | null;

  // —— For experts (services + jobs) ——
  /** Max services an expert can publish. */
  maxServices?: number | null;
  /** Max active jobs an expert can have. */
  maxJobs?: number | null;
  /** Expert can use priority/featured listing. */
  canPriorityListing?: boolean;
  /** Max concurrent applications (bids) an expert can have. */
  maxActiveBids?: number | null;
  /** Bid appears ahead of non-priority bids when the customer views proposals (marketplace-style). */
  canPriorityBid?: boolean;
  /** Show a Pro-style badge on the profile for experts and craftsmen. */
  canProBadge?: boolean;

  // —— For businesses ——
  /** Max services a business can publish. */
  maxBusinessServices?: number | null;
  /** Max team members or slots. */
  maxTeamSlots?: number | null;
  /** Business can be featured. */
  canBusinessFeatured?: boolean;
  /** Trusted / verified business badge on the company profile. */
  canTrustedBusinessBadge?: boolean;

  /**
   * Per-period usage caps (counts actions in the window). Omitted or empty = no metered limit for that action.
   * Enforced at: create need, create service, create bid, create job.
   */
  usageQuotas?: Partial<Record<UsageQuotaFeatureKey, PlanUsageQuotaDef | null>>;
};

export type Plan = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  durationDays: number | null;
  trialDays: number;
  maxServices: number | null;
  maxProjects: number | null;
  features: string[];
  /** Primary roles that may list and subscribe to this plan. */
  allowedRoles: PlanSubscriberRole[];
  planLimits?: PlanLimits | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CreatePlanBody = {
  slug: string;
  name: string;
  description?: string;
  price: number;
  currency?: string;
  billingCycle?: BillingCycle;
  durationDays?: number;
  trialDays?: number;
  maxServices?: number;
  maxProjects?: number;
  features?: string[];
  allowedRoles?: PlanSubscriberRole[];
  planLimits?: PlanLimits | null;
  sortOrder?: number;
};

export type UpdatePlanBody = Partial<CreatePlanBody> & {
  isActive?: boolean;
};

/** Normalized plan limits for enforcement (null = no limit / not set). */
export type EffectivePlanLimits = {
  maxServices: number | null;
  maxNeeds: number | null;
  maxJobs: number | null;
  canPriorityListing: boolean;
  bidsVisibleToCustomer: BidsVisibleToCustomer | null;
  bidsVisibleTopN: number | null;
  maxBidsPerNeed: number | null;
  maxActiveBids: number | null;
  maxBusinessServices: number | null;
  maxTeamSlots: number | null;
  canBusinessFeatured: boolean;
  /** Normalized metered quotas (only valid keys; null max skipped at parse time). */
  usageQuotas: Partial<Record<UsageQuotaFeatureKey, PlanUsageQuotaDef>>;
};

// ---------------------------------------------------------------------------
// Plan subscription (period + expiry)
// ---------------------------------------------------------------------------

export type PlanSubscription = {
  id: string;
  userId: string;
  planId: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
};

export type SubscribeToPlanResponse = {
  plan: Plan;
  walletBalance: number;
  subscriptionEndsAt: string;
};

/** How inventory-style limits reset (concurrent slots). Metered quotas use `usageQuotas[].period`. */
export type PlanUsageResetPolicy = 'concurrent_slots';

export type PlanUsageQuotaLine = {
  featureKey: UsageQuotaFeatureKey;
  period: UsageQuotaPeriodType;
  maxPerPeriod: number;
  used: number;
  remaining: number;
  periodEndsAt: string;
};

/** Current usage vs plan caps for the signed-in user (one branch populated by role). */
export type PlanUsageSummary = {
  plansFeatureEnabled: boolean;
  resetPolicy: PlanUsageResetPolicy;
  /** Metered uses in the current window (only quotas relevant to the user role). */
  usageQuotas: PlanUsageQuotaLine[];
  customer: {
    maxNeeds: number | null;
    activeNeedsCount: number;
    remainingNeeds: number | null;
  } | null;
  individualProvider: {
    maxServices: number | null;
    servicesCount: number;
    remainingServices: number | null;
    maxActiveBids: number | null;
    pendingBidsCount: number;
    remainingActiveBids: number | null;
  } | null;
  business: {
    maxJobs: number | null;
    jobsCount: number;
    remainingJobs: number | null;
    maxBusinessServices: number | null;
    servicesCount: number;
    remainingBusinessServices: number | null;
  } | null;
};

/** Parse `plan_limits.usageQuotas` from DB/API into enforced shape. */
export function normalizeUsageQuotasFromPlanLimits(
  raw: unknown,
): Partial<Record<UsageQuotaFeatureKey, PlanUsageQuotaDef>> {
  const out: Partial<Record<UsageQuotaFeatureKey, PlanUsageQuotaDef>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  const quotas = obj.usageQuotas;
  if (!quotas || typeof quotas !== 'object' || Array.isArray(quotas)) return out;
  const q = quotas as Record<string, unknown>;
  for (const key of USAGE_QUOTA_FEATURE_KEYS) {
    const v = q[key];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const max = o.maxPerPeriod;
    const period = o.period;
    if (typeof max !== 'number' || !Number.isFinite(max) || max < 1) continue;
    if (period !== 'billing_cycle' && period !== 'calendar_month') continue;
    out[key] = { maxPerPeriod: Math.floor(max), period };
  }
  return out;
}

/** Metered quota keys to show / enforce per primary role. */
export const USAGE_QUOTA_KEYS_FOR_ROLE: Record<
  'customer' | 'expert' | 'craftsman' | 'business',
  readonly UsageQuotaFeatureKey[]
> = {
  customer: ['new_needs_per_period'],
  expert: ['new_services_per_period', 'new_bids_per_period'],
  craftsman: ['new_services_per_period', 'new_bids_per_period'],
  business: ['new_jobs_per_period', 'new_services_per_period'],
};
