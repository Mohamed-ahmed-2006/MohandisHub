import type {
  ApiSuccessBody,
  CreateServiceBody,
  Service,
  ServiceCategory,
  ServiceSearchResult,
  UpdateServiceBody,
} from '@mohandishub/shared';

import { getApiBaseUrl } from '@/lib/env';

async function apiReq<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? 'Request failed');
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

export const servicesApiClient = {
  getCategories: async (): Promise<ServiceCategory[]> => {
    const response = await fetch(`${getApiBaseUrl()}/api/services/categories`);
    if (!response.ok) return [];
    const body = (await response.json()) as ApiSuccessBody<ServiceCategory[]>;
    return body.data;
  },

  searchServices: async (params: {
    categoryId?: string;
    city?: string;
    area?: string;
    providerType?: string;
    q?: string;
    minRating?: number;
    minPrice?: number;
    maxPrice?: number;
    verifiedOnly?: boolean;
    sort?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    items: ServiceSearchResult[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> => {
    const query = new URLSearchParams();
    if (params.categoryId) query.set('categoryId', params.categoryId);
    if (params.city) query.set('city', params.city);
    if (params.area) query.set('area', params.area);
    if (params.providerType) query.set('providerType', params.providerType);
    if (params.q) query.set('q', params.q);
    if (params.minRating != null) query.set('minRating', String(params.minRating));
    if (params.minPrice != null) query.set('minPrice', String(params.minPrice));
    if (params.maxPrice != null) query.set('maxPrice', String(params.maxPrice));
    if (params.verifiedOnly === true) query.set('verifiedOnly', 'true');
    if (params.sort) query.set('sort', params.sort);
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    const qs = query.toString();

    const response = await fetch(`${getApiBaseUrl()}/api/services/search${qs ? `?${qs}` : ''}`);
    if (!response.ok) return { items: [], total: 0, page: 1, limit: 20, totalPages: 0 };
    const body = (await response.json()) as ApiSuccessBody<{
      items: ServiceSearchResult[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>;
    return body.data;
  },

  listMyServices: (token: string, page = 1, limit = 20) =>
    apiReq<{ items: Service[]; total: number; page: number; limit: number; totalPages: number }>(
      `/api/services/my?page=${page}&limit=${limit}`,
      token,
    ),

  createService: (
    token: string,
    body: CreateServiceBody & { submitForReview?: boolean },
  ) =>
    apiReq<Service>('/api/services', token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateService: (token: string, id: string, body: UpdateServiceBody) =>
    apiReq<Service>(`/api/services/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  submitService: (token: string, id: string) =>
    apiReq<Service>(`/api/services/${id}/submit`, token, { method: 'POST' }),

  pauseService: (token: string, id: string) =>
    apiReq<Service>(`/api/services/${id}/pause`, token, { method: 'POST' }),

  activateService: (token: string, id: string) =>
    apiReq<Service>(`/api/services/${id}/activate`, token, { method: 'POST' }),
};
