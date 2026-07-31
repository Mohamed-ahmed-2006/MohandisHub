import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

type ApiSuccess<T> = { ok: true; data: T };
type ApiError = { error?: { code?: string; message?: string } };

/** `need` was never storable — the destination CHECK cannot express it. */
export type AdLinkType = 'profile' | 'service';

/** Moderation lifecycle. */
export type AdStatus =
  | 'pending_review'
  | 'scheduled'
  | 'active'
  | 'paused_by_admin'
  | 'rejected'
  | 'expired'
  | 'cancelled';

/** Billing lifecycle, independent of moderation status. */
export type AdBillingStatus =
  | 'legacy'
  | 'pending_review'
  | 'rejected'
  | 'awaiting_start'
  | 'awaiting_credits'
  | 'active'
  | 'renewal_required'
  | 'cancelled';

export type Advertisement = {
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
  /** LEGACY (EGP). 0 for every weekly campaign. */
  amount_paid: string | null;
  starts_at: string | null;
  expires_at: string | null;
  priority: number;
  target_roles: string[];
  target_countries: string[];
  target_cities: string[];
  target_categories: string[];
  target_languages: string[];
  impressions: number;
  clicks: number;
  advertiser_name?: string;

  // Moderation record.
  reviewed_at: string | null;
  rejection_reason: string | null;

  // Weekly billing state.
  billing_model: 'legacy' | 'weekly';
  billing_status: AdBillingStatus;
  current_period_starts_at: string | null;
  current_period_ends_at: string | null;
  manual_renewal_required: boolean;
  renewal_count: number;
};

export type AdPeriod = {
  id: string;
  periodNumber: number;
  startsAt: string;
  endsAt: string;
  /** Immutable — an admin price change never rewrites a bought week. */
  mhcPriceSnapshot: number;
  status: string;
  renewalSource: string;
  hasCharge: boolean;
};

/**
 * Why the scheduler stopped renewing. A reason, not a lifecycle state — the
 * campaign is still `renewal_required` (or `awaiting_credits` before its first
 * week), and this says what stood in the way.
 */
export type AdAutoRenewPausedReason =
  | 'insufficient_credits'
  | 'pricing_unavailable'
  | 'max_weeks_reached'
  | 'end_date_reached';

export type AdRenewalHistoryEntry = {
  id: string;
  eventType: string;
  /** The week this event concerns. */
  periodNumber: number;
  createdAt: string;
  mhcCharged: number | null;
  requiredMhc: number | null;
};

export type AdBillingState = {
  advertisementId: string;
  billingModel: 'legacy' | 'weekly';
  billingStatus: AdBillingStatus;
  moderationStatus: AdStatus;
  /** MHC per advertisement WEEK. */
  weeklyMhcPrice: number;
  currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null;
  manualRenewalRequired: boolean;
  renewalCount: number;
  rejectionReason: string | null;
  reviewedAt: string | null;
  canRenew: boolean;
  canActivate: boolean;
  /** Whether this campaign may be switched to automatic renewal at all. */
  autoRenewalAvailable: boolean;
  autoRenewEnabled: boolean;
  renewalMode: 'manual' | 'automatic';
  maximumWeeks: number | null;
  renewalEndDate: string | null;
  autoRenewEnabledAt: string | null;
  autoRenewConsentVersion: string | null;
  /** The terms version this client must accept to enable automatic renewal. */
  consentVersion: string;
  autoRenewPausedReason: AdAutoRenewPausedReason | null;
  autoRenewPausedAt: string | null;
  lastRenewalOutcome: string | null;
  lastRenewalAttemptAt: string | null;
  /** Weeks bought so far, including the first. Counts against maximumWeeks. */
  periodsUsed: number;
  nextRenewalAt: string | null;
  canRetryAutomaticRenewal: boolean;
  /** The viewer's own credit balance. Null when an admin views someone else's. */
  creditBalance: number | null;
  renewalHistory: AdRenewalHistoryEntry[];
  periods: AdPeriod[];
};

export type AdAutoRenewalState = {
  advertisementId: string;
  renewalMode: 'manual' | 'automatic';
  autoRenewEnabled: boolean;
  maximumWeeks: number | null;
  renewalEndDate: string | null;
  autoRenewEnabledAt: string | null;
  autoRenewConsentVersion: string | null;
  autoRenewPausedReason: AdAutoRenewPausedReason | null;
  autoRenewPausedAt: string | null;
  lastRenewalOutcome: string | null;
  lastRenewalAttemptAt: string | null;
  periodsUsed: number;
  nextRenewalAt: string | null;
  autoRenewalAvailable: boolean;
  consentVersion: string;
};

export type AdminAdControls = {
  acceptAds: boolean;
  /**
   * MHC charged per advertisement WEEK, from `mhc_action_prices.advertisement`.
   * MHC is a platform credit, not money — render it with formatMhc, never with a
   * currency symbol.
   */
  mhcPrice: number;
};

type ApiOpts = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token: string;
  body?: unknown;
  allow404AsEmpty?: boolean;
  allow404As?: unknown;
  idempotencyKey?: string;
};

async function apiReq<T>(path: string, opts: ApiOpts): Promise<T> {
  const response = await fetchWithAuthRetry(
    `${getApiBaseUrl()}${path}`,
    {
      method: opts.method ?? 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.token}`,
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    },
    opts.token,
  );
  if (!response.ok) {
    if (response.status === 404 && opts.allow404As !== undefined) {
      return opts.allow404As as T;
    }
    if (response.status === 404 && opts.allow404AsEmpty) {
      return [] as T;
    }
    const body = (await response.json().catch(() => ({}))) as ApiError;
    const error = new Error(body.error?.message ?? 'Request failed') as Error & { code?: string };
    // The screen distinguishes "buy more credits" from every other failure.
    if (body.error?.code) error.code = body.error.code;
    throw error;
  }
  const json = (await response.json()) as ApiSuccess<T>;
  return json.data;
}

export const advertisementsApiClient = {
  getActiveAds: (
    token: string,
    params?: { locale?: string; city?: string; country?: string; role?: string },
  ) => {
    const qs = new URLSearchParams();
    if (params?.locale) qs.set('locale', params.locale);
    if (params?.city) qs.set('city', params.city);
    if (params?.country) qs.set('country', params.country);
    if (params?.role) qs.set('role', params.role);
    const query = qs.toString();
    return apiReq<Advertisement[]>(`/api/advertisements/active${query ? `?${query}` : ''}`, {
      token,
      allow404AsEmpty: true,
    });
  },
  getAdControls: (token: string) =>
    apiReq<AdminAdControls>('/api/advertisements/controls', {
      token,
      allow404As: { acceptAds: true, mhcPrice: 0 },
    }),
  /**
   * Submit a campaign for review. No duration is sent: an advertisement is sold
   * one seven-day week at a time, so there is nothing for a caller to choose.
   */
  createAd: (
    token: string,
    body: {
      startsAt?: string;
      titleEn: string;
      titleAr?: string;
      descriptionEn?: string;
      descriptionAr?: string;
      imageUrl: string;
      ctaTextEn?: string;
      ctaTextAr?: string;
      linkType: AdLinkType;
      linkTarget?: string;
      targetRoles?: string[];
      targetCountries?: string[];
      targetCities?: string[];
      targetCategories?: string[];
      targetLanguages?: string[];
      targetMinBudget?: number;
      targetMaxBudget?: number;
    },
    /**
     * Stable per-attempt UUID. Sending it is what stops a double click, a retry
     * or a flaky connection from creating two campaigns; the server enforces it
     * with a unique index, not in memory.
     */
    idempotencyKey?: string,
  ) =>
    apiReq<Advertisement>('/api/advertisements', {
      method: 'POST',
      token,
      body,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    }),
  getMyAds: (token: string, params?: { page?: number; limit?: number; status?: AdStatus }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.status) qs.set('status', params.status);
    const query = qs.toString();
    return apiReq<{ rows: Advertisement[]; total: number }>(
      `/api/advertisements/my${query ? `?${query}` : ''}`,
      { token, allow404As: { rows: [], total: 0 } },
    );
  },
  getBillingState: (token: string, adId: string) =>
    apiReq<AdBillingState>(`/api/advertisements/${adId}/billing`, { token }),
  /** Buy one more seven-day week. */
  renewAd: (token: string, adId: string, idempotencyKey?: string) =>
    apiReq<{ mhcCharged: number; created: boolean }>(`/api/advertisements/${adId}/renew`, {
      method: 'POST',
      token,
      body: {},
      ...(idempotencyKey ? { idempotencyKey } : {}),
    }),
  /** Retry the first week of an already-approved campaign after topping up. */
  activateAd: (token: string, adId: string, idempotencyKey?: string) =>
    apiReq<{ mhcCharged: number; created: boolean }>(`/api/advertisements/${adId}/activate`, {
      method: 'POST',
      token,
      body: {},
      ...(idempotencyKey ? { idempotencyKey } : {}),
    }),
  /**
   * Turn automatic weekly renewal on or off, or change its bounds.
   *
   * Charges nothing. `consentAccepted` is mandatory when enabling — the server
   * refuses without it, so the checkbox is not decoration.
   *
   * `undefined` leaves a bound as stored; `null` clears it. Sending neither
   * bound while enabling is refused server-side: automatic renewal is never
   * open-ended.
   */
  setAutoRenewal: (
    token: string,
    adId: string,
    body: {
      enabled: boolean;
      consentAccepted?: boolean;
      maximumWeeks?: number | null;
      renewalEndDate?: string | null;
    },
  ) =>
    apiReq<AdAutoRenewalState>(`/api/advertisements/${adId}/auto-renewal`, {
      method: 'PUT',
      token,
      body,
    }),
  getAutoRenewalState: (token: string, adId: string) =>
    apiReq<AdAutoRenewalState>(`/api/advertisements/${adId}/auto-renewal`, { token }),
  /** Retry a paused automatic renewal after adding credits. */
  retryAutoRenewal: (token: string, adId: string) =>
    apiReq<{ renewed: boolean; mhcCharged: number; periodNumber: number; periodEndsAt: string }>(
      `/api/advertisements/${adId}/auto-renewal/retry`,
      { method: 'POST', token, body: {} },
    ),
  /** Every week this campaign has bought, with each week's own price snapshot. */
  getPeriodHistory: (token: string, adId: string, params?: { page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return apiReq<{
      rows: (AdPeriod & { createdAt: string })[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(`/api/advertisements/${adId}/periods${query ? `?${query}` : ''}`, { token });
  },
  cancelAd: (token: string, adId: string) =>
    apiReq<{ cancelled: boolean }>(`/api/advertisements/${adId}`, { method: 'DELETE', token }),
  trackAdClick: (token: string, adId: string) =>
    apiReq<{ ok: true }>(`/api/advertisements/${adId}/click`, { method: 'POST', token, body: {} }),
  adminListAds: (token: string, params?: { page?: number; limit?: number; status?: AdStatus }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.status) qs.set('status', params.status);
    const query = qs.toString();
    return apiReq<{ rows: Advertisement[]; total: number }>(
      `/api/advertisements/admin/all${query ? `?${query}` : ''}`,
      { token },
    );
  },
  /** Approve. An immediate campaign is charged for its first week right here. */
  adminApprove: (token: string, adId: string, reason?: string) =>
    apiReq<{ mhcCharged: number; created: boolean }>(
      `/api/advertisements/admin/${adId}/approve`,
      { method: 'POST', token, body: reason ? { reason } : {} },
    ),
  /** Reject with a reason the advertiser is shown. Charges nothing. */
  adminReject: (token: string, adId: string, reason: string) =>
    apiReq<Advertisement>(`/api/advertisements/admin/${adId}/reject`, {
      method: 'POST',
      token,
      body: { reason },
    }),
  /** Start an approved campaign whose scheduled start has arrived. */
  adminActivateDue: (token: string, adId: string) =>
    apiReq<{ mhcCharged: number; created: boolean }>(
      `/api/advertisements/admin/${adId}/activate-due`,
      { method: 'POST', token, body: {} },
    ),
  adminSetStatus: (
    token: string,
    adId: string,
    body: { status: 'paused_by_admin' | 'cancelled'; reason?: string },
  ) =>
    apiReq<Advertisement>(`/api/advertisements/admin/${adId}/status`, {
      method: 'PUT',
      token,
      body,
    }),
  adminSchedule: (
    token: string,
    adId: string,
    body: { startsAt?: string | null; expiresAt?: string | null; reason?: string },
  ) =>
    apiReq<Advertisement>(`/api/advertisements/admin/${adId}/schedule`, {
      method: 'POST',
      token,
      body,
    }),
  adminPricingOverride: (token: string, adId: string, amount: number) =>
    apiReq<Advertisement>(`/api/advertisements/admin/${adId}/pricing`, {
      method: 'PUT',
      token,
      body: { amount },
    }),
  adminGetControls: (token: string) =>
    apiReq<AdminAdControls>('/api/advertisements/admin/controls', {
      token,
      allow404As: { acceptAds: true, mhcPrice: 0 },
    }),
  adminUpdateControls: (token: string, body: AdminAdControls) =>
    apiReq<AdminAdControls>('/api/advertisements/admin/controls', { method: 'PUT', token, body }),
};
