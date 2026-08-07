import type {
  AdvertisementCommercialOwnerKind,
  AdvertisementOwnershipState,
} from './advertisement-ownership.constants.js';

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

/**
 * Why the scheduler stopped renewing a campaign automatically.
 *
 * A reason, not a lifecycle state. `billing_status` still says what the campaign
 * IS (`renewal_required` — the paid week ended and another must be bought); this
 * says why nothing bought it. Keeping them separate is what leaves the
 * advertiser's remedy — renew manually — reachable.
 *
 * A non-NULL value is also the gate that stops a failed boundary from being
 * retried on a timer. Only an explicit advertiser action clears it.
 */
export type AdAutoRenewPausedReason =
  | 'insufficient_credits'
  | 'pricing_unavailable'
  | 'max_weeks_reached'
  | 'end_date_reached';

/** What the most recent renewal attempt did. For display; the log is authoritative. */
export type AdLastRenewalOutcome = 'succeeded' | AdAutoRenewPausedReason;

/**
 * One boundary outcome. The first eight are deduplicated by
 * `uq_ad_renewal_event_boundary`; the two configuration acknowledgements are
 * not, because turning automatic renewal off and on again is a real sequence of
 * two decisions.
 */
export type AdRenewalEventType =
  | 'initial_activated'
  | 'renewal_succeeded'
  | 'renewal_failed_insufficient_credits'
  | 'renewal_failed_pricing_unavailable'
  | 'manual_renewal_required'
  | 'auto_renew_stopped_max_weeks'
  | 'auto_renew_stopped_end_date'
  | 'renewal_reminder'
  | 'auto_renew_enabled'
  | 'auto_renew_disabled';

/** One row of the boundary event log / notification outbox. */
export type AdvertisementRenewalEventRow = {
  id: string;
  advertisement_id: string;
  advertiser_id: string;
  /** The period number the campaign was trying to buy. */
  boundary_period_number: number;
  event_type: AdRenewalEventType;
  period_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;

  // Delivery lease. Push and email have no downstream idempotency key, so these
  // buy AT-LEAST-ONCE external delivery with a bounded, observable retry — not
  // exactly-once, which is not achievable against those providers.
  delivery_status: AdRenewalDeliveryStatus;
  /** When this row becomes claimable again: lease expiry, or backoff floor. */
  claim_expires_at: string | null;
  claimed_at: string | null;
  attempt_count: number;
  last_delivery_error: string | null;
  delivered_at: string | null;
  /** The in-app row this event produced, so a retry never writes a second. */
  in_app_notification_id: string | null;
};

export type AdRenewalDeliveryStatus = 'pending' | 'claimed' | 'delivered' | 'failed';

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
  /**
   * LEGACY owner. Preserved unchanged for the whole Wave 3 compatibility period
   * — it remains the moderation, billing and renewal anchor, and it is still the
   * account weekly billing charges. Commercial ownership is resolved through
   * `advertisement-ownership.repository.ts`, never by reading this column alone.
   */
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

  // Automatic renewal consent and scheduler state (20260731090000).
  /** NOT NULL whenever auto_renew_enabled is true — enforced by a CHECK. */
  auto_renew_enabled_at: string | null;
  auto_renew_enabled_by: string | null;
  auto_renew_consent_version: string | null;
  auto_renew_paused_reason: AdAutoRenewPausedReason | null;
  auto_renew_paused_at: string | null;
  last_renewal_outcome: AdLastRenewalOutcome | null;
  last_renewal_attempt_at: string | null;

  // Commercial identity ownership (20260807090000). Additive beside
  // `advertiser_id`, which is untouched. NULL/`legacy_user_owned` is the correct
  // state for every personal provider campaign until the PCI slice.
  commercial_owner_kind: AdvertisementCommercialOwnerKind | null;
  business_commercial_identity_id: string | null;
  commercial_ownership_state: AdvertisementOwnershipState;
  commercial_ownership_assigned_at: string | null;
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
  /**
   * The boundary event this call committed, if any. The caller hands it to the
   * notifier AFTER its own COMMIT; an id that is never handed over is delivered
   * by the sweep instead, never lost.
   */
  renewalEventId?: string | null;
};
