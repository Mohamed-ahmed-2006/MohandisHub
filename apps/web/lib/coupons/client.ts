import type {
  CouponPreview,
  CouponPreviewRequest,
  CreateProviderCouponCampaignBody,
  ProviderCouponCampaignPreview,
  ProviderCouponCampaignRequest,
} from '@mohandishub/shared';

import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

const request = async <T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetchWithAuthRetry(
    `${getApiBaseUrl()}${path}`,
    {
      credentials: 'include',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers ?? {}),
      },
    },
    accessToken,
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body &&
      'error' in body &&
      typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
        ? (body as { error: { message: string } }).error.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return (body as { data: T }).data;
};

export const couponsApiClient = {
  validate: (accessToken: string, body: CouponPreviewRequest) =>
    request<CouponPreview>(accessToken, '/api/coupons/validate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  previewCampaign: (
    accessToken: string,
    body: Pick<CreateProviderCouponCampaignBody, 'requestedQuantity'>,
  ) =>
    request<ProviderCouponCampaignPreview>(accessToken, '/api/coupons/campaigns/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createCampaign: (accessToken: string, body: CreateProviderCouponCampaignBody) =>
    request<ProviderCouponCampaignRequest>(accessToken, '/api/coupons/campaigns', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listMyCampaigns: (accessToken: string) =>
    request<ProviderCouponCampaignRequest[]>(accessToken, '/api/coupons/campaigns/me'),
};
