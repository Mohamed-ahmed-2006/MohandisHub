import type { ApiSuccessBody, ServiceCategory, ServiceSearchResult } from '@mohandishub/shared';

import { getApiBaseUrl } from '@/lib/env';

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
};
