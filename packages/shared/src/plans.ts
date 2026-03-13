// ---------------------------------------------------------------------------
// Plan types — shared between API and frontend
// ---------------------------------------------------------------------------

export type BillingCycle = 'monthly' | 'quarterly' | 'yearly' | 'one_time';

/** Bids visibility for customer when viewing bids on a need. */
export type BidsVisibleToCustomer = 'all' | 'top_n' | 'premium_first';

/** Structured limits and feature flags per plan (enforced by API). */
export type PlanLimits = {
  maxServices?: number | null;
  maxNeeds?: number | null;
  maxJobs?: number | null;
  canPriorityListing?: boolean;
  bidsVisibleToCustomer?: BidsVisibleToCustomer | null;
  /** When bidsVisibleToCustomer is 'top_n', show only this many bids (default 3). */
  bidsVisibleTopN?: number | null;
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
