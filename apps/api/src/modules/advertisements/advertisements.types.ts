/**
 * `advertisements.link_type`. `need` and `external` exist in the database CHECK
 * for historical rows, but `advertisements_destination_check` (20260727100000)
 * cannot be satisfied by either — it demands a provider or a service
 * destination — so neither is offered to a new campaign.
 */
export type AdLinkType = 'profile' | 'service';

/**
 * `advertisements.status` — the MODERATION lifecycle. What an admin has decided
 * about this campaign, and whether it may serve.
 */
export type AdStatus =
  | 'pending_review'
  | 'scheduled'
  | 'active'
  | 'paused_by_admin'
  | 'rejected'
  | 'expired'
  | 'cancelled';

/** `advertisements.billing_model`. `legacy` is never billed by a weekly path. */
export type AdBillingModel = 'legacy' | 'weekly';

/**
 * `advertisements.billing_status` — the BILLING lifecycle, deliberately separate
 * from moderation `status`. It is what distinguishes an approved campaign that
 * ran out of credits (`scheduled` + `awaiting_credits`) from one nobody has
 * reviewed yet (`pending_review` + `pending_review`).
 */
export type AdBillingStatus =
  | 'legacy'
  | 'pending_review'
  | 'rejected'
  | 'awaiting_start'
  | 'awaiting_credits'
  | 'active'
  | 'renewal_required'
  | 'cancelled';

export type AdRenewalMode = 'manual' | 'automatic';

export type AdPeriodStatus = 'scheduled' | 'active' | 'expired' | 'cancelled' | 'failed';

export type AdRenewalSource = 'initial' | 'manual' | 'automatic' | 'legacy';

export type AdPricingRuleRow = {
  id: string;
  name: string;
  is_active: boolean;
  role_scope: string[];
  country_scope: string[];
  city_scope: string[];
  category_scope: string[];
  min_duration_days: number | null;
  max_duration_days: number | null;
  price_multiplier: string;
  flat_fee: string;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AdvertisementRow = {
  id: string;
  advertiser_id: string;
  title_en: string;
  title_ar: string | null;
  description_en: string | null;
  description_ar: string | null;
  image_url: string;
  cta_text_en: string | null;
  cta_text_ar: string | null;
  link_type: AdLinkType;
  link_target: string | null;
  status: AdStatus;
  /** LEGACY (EGP). 0 for every weekly campaign; MHC is recorded per period. */
  amount_paid: string | null;
  starts_at: string | null;
  expires_at: string | null;
  priority: number;
  target_roles: string[];
  target_countries: string[];
  target_cities: string[];
  target_categories: string[];
  target_languages: string[];
  target_min_budget: string | null;
  target_max_budget: string | null;
  admin_forced_starts_at: string | null;
  admin_forced_expires_at: string | null;
  admin_status_reason: string | null;
  admin_price_override: string | null;
  impressions: number;
  clicks: number;
  created_at: string;
  updated_at: string;
  advertiser_name?: string;

  // Moderation record (columns predate weekly billing; 20260727100000).
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  destination_provider_id: string | null;
  destination_service_id: string | null;

  // Weekly billing state (20260730120000).
  billing_model: AdBillingModel;
  billing_status: AdBillingStatus;
  renewal_mode: AdRenewalMode;
  auto_renew_enabled: boolean;
  maximum_weeks: number | null;
  renewal_end_date: string | null;
  current_period_starts_at: string | null;
  current_period_ends_at: string | null;
  next_renewal_at: string | null;
  renewal_count: number;
  manual_renewal_required: boolean;
};

/** One paid seven-day advertisement week. */
export type AdvertisementPeriodRow = {
  id: string;
  advertisement_id: string;
  period_number: number;
  starts_at: string;
  ends_at: string;
  /** Immutable record of what this week cost. Never rewritten by a price change. */
  mhc_price_snapshot: string;
  action_charge_id: string | null;
  status: AdPeriodStatus;
  renewal_source: AdRenewalSource;
  client_idempotency_key: string | null;
  created_at: string;
  updated_at: string;
};

/** What a caller learns from activating or renewing a week. */
export type AdvertisementPeriodResult = {
  advertisement: AdvertisementRow;
  period: AdvertisementPeriodRow | null;
  /** MHC actually debited. 0 for a free week and for an idempotent replay. */
  mhcCharged: number;
  /** False when the call resolved to a week that already existed. */
  created: boolean;
};
