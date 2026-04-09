import { getApiBaseUrl } from '@/lib/env';

type ApiSuccess<T> = { ok: true; data: T };
type ApiError = { error?: { code?: string; message?: string } };

export type AdLinkType = 'profile' | 'service' | 'need' | 'external';
export type AdStatus = 'pending_payment' | 'active' | 'expired' | 'cancelled' | 'paused_by_admin';

export type Advertisement = {
  id: string;
  advertiser_id: string;
  ad_plan_id: string | null;
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
  admin_price_override?: string | null;
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
};

export type AdvertisementPlan = {
  id: string;
  name_en: string;
  name_ar: string | null;
  duration_days: number;
  price: string;
  currency: string;
  description_en: string | null;
  description_ar: string | null;
};

type ApiOpts = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token: string;
  body?: unknown;
  allow404AsEmpty?: boolean;
  allow404As?: unknown;
};

async function apiReq<T>(path: string, opts: ApiOpts): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (!response.ok) {
    if (response.status === 404 && opts.allow404As !== undefined) {
      return opts.allow404As as T;
    }
    if (response.status === 404 && opts.allow404AsEmpty) {
      return [] as T;
    }
    const body = (await response.json().catch(() => ({}))) as ApiError;
    if (
      response.status === 404 &&
      (path.startsWith('/api/advertisements/admin') || path.startsWith('/api/advertisements/pricing-rules'))
    ) {
      throw new Error(
        'Advertisements admin endpoints are not available on this API deployment yet. Please deploy the latest API version.',
      );
    }
    throw new Error(body.error?.message ?? 'Request failed');
  }
  const json = (await response.json()) as ApiSuccess<T>;
  return json.data;
}

export const advertisementsApiClient = {
  getActiveAds: (token: string, params?: { locale?: string; city?: string; country?: string; role?: string }) => {
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
  getAdPlans: (token: string) =>
    apiReq<AdvertisementPlan[]>('/api/advertisements/plans', { token, allow404As: [] }),
  createAd: (
    token: string,
    body: {
      adPlanId: string;
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
  ) => apiReq<Advertisement>('/api/advertisements', { method: 'POST', token, body }),
  updateAd: (token: string, adId: string, body: Record<string, unknown>) =>
    apiReq<Advertisement>(`/api/advertisements/${adId}`, { method: 'PUT', token, body }),
  payForAd: (token: string, adId: string) =>
    apiReq<{ paid: boolean; amount: number; startsAt: string; expiresAt: string }>(
      `/api/advertisements/${adId}/pay`,
      { method: 'POST', token, body: {} },
    ),
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
  adminSetStatus: (
    token: string,
    adId: string,
    body: { status: 'active' | 'paused_by_admin' | 'cancelled'; reason?: string },
  ) => apiReq<Advertisement>(`/api/advertisements/admin/${adId}/status`, { method: 'PUT', token, body }),
  adminSchedule: (token: string, adId: string, body: { startsAt?: string | null; expiresAt?: string | null; reason?: string }) =>
    apiReq<Advertisement>(`/api/advertisements/admin/${adId}/schedule`, { method: 'POST', token, body }),
  adminPricingOverride: (token: string, adId: string, amount: number) =>
    apiReq<Advertisement>(`/api/advertisements/admin/${adId}/pricing`, {
      method: 'PUT',
      token,
      body: { amount },
    }),
};

