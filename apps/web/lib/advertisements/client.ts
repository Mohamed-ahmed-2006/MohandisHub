import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

type ApiSuccess<T> = { ok: true; data: T };
type ApiError = { error?: { code?: string; message?: string } };

export type AdLinkType = 'profile' | 'service';
export type AdStatus =
  | 'pending_review'
  | 'scheduled'
  | 'active'
  | 'paused_by_admin'
  | 'rejected'
  | 'expired'
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
  deliveryToken?: string;
  rejection_reason?: string | null;
  cancellation_refund_piastres?: string;
};

export type AdminAdControls = {
  acceptAds: boolean;
  pricePerDay: number;
};

type ApiOpts = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token: string;
  body?: unknown;
  allow404AsEmpty?: boolean;
  allow404As?: unknown;
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
    throw new Error(body.error?.message ?? 'Request failed');
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
      allow404As: { acceptAds: false, pricePerDay: 0 },
    }),
  createAd: (
    token: string,
    body: {
      durationDays: number;
      startsAt?: string;
      titleEn: string;
      titleAr?: string;
      descriptionEn?: string;
      descriptionAr?: string;
      imageUrl: string;
      bannerUploadId: string;
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
  ) => apiReq<Advertisement>('/api/advertisements', { method: 'POST', token, body }),
  getQuote: (token: string, durationDays: number) =>
    apiReq<{
      durationDays: number;
      dailyPriceEgp: number;
      totalEgp: number;
      currency: 'EGP';
    }>(`/api/advertisements/quote?durationDays=${durationDays}`, { token }),
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
  cancelAd: (token: string, adId: string) =>
    apiReq<{ advertisement: Advertisement; cancelled: true; refundAmount: number }>(
      `/api/advertisements/${adId}`,
      { method: 'DELETE', token },
    ),
  trackAdImpression: (token: string, adId: string, deliveryToken: string) =>
    apiReq<{ accepted: true }>(`/api/advertisements/${adId}/impression`, {
      method: 'POST',
      token,
      body: { deliveryToken },
    }),
  trackAdClick: (token: string, adId: string, deliveryToken: string) =>
    apiReq<{ accepted: true }>(`/api/advertisements/${adId}/click`, {
      method: 'POST',
      token,
      body: { deliveryToken },
    }),
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
  adminSetStatus: (
    token: string,
    adId: string,
    body: { status: 'active' | 'paused_by_admin' | 'cancelled'; reason?: string },
  ) =>
    apiReq<Advertisement>(`/api/advertisements/admin/${adId}/status`, {
      method: 'PUT',
      token,
      body,
    }),
  adminReview: (
    token: string,
    adId: string,
    body: { decision: 'approve' | 'reject'; reason?: string },
  ) =>
    apiReq<Advertisement>(`/api/advertisements/admin/${adId}/review`, {
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
  adminGetControls: (token: string) =>
    apiReq<AdminAdControls>('/api/advertisements/admin/controls', {
      token,
      allow404As: { acceptAds: false, pricePerDay: 0 },
    }),
  adminUpdateControls: (token: string, body: AdminAdControls) =>
    apiReq<AdminAdControls>('/api/advertisements/admin/controls', { method: 'PUT', token, body }),
};
