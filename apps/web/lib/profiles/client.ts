import { sanitizePublicUserProfile } from '@mohandishub/shared';
import type {
  AcademicRecord,
  AcademicRecordBody,
  ApiErrorBody,
  ApiSuccessBody,
  BusinessProfile,
  CraftsmanProfile,
  CustomerProfile,
  ExpertProfile,
  IdentityDocument,
  IdentityDocumentBody,
  PublicUserProfile,
  UpdateBusinessProfileBody,
  UpdateCraftsmanProfileBody,
  UpdateCustomerProfileBody,
  UpdateExpertProfileBody,
} from '@mohandishub/shared';

import { ApiClientRequestError } from '../auth/client';

import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

type ApiRequestOptions = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  accessToken: string;
};

const isApiErrorBody = (value: unknown): value is ApiErrorBody => {
  if (!value || typeof value !== 'object') return false;
  const maybeError = (value as { error?: unknown }).error;
  if (!maybeError || typeof maybeError !== 'object') return false;
  const code = (maybeError as { code?: unknown }).code;
  const message = (maybeError as { message?: unknown }).message;
  return typeof code === 'string' && typeof message === 'string';
};

const apiRequest = async <T>({
  method,
  path,
  body,
  accessToken,
}: ApiRequestOptions): Promise<T> => {
  const response = await fetchWithAuthRetry(
    `${getApiBaseUrl()}${path}`,
    {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    accessToken,
  );

  if (!response.ok) {
    const rawErrorBody: unknown = await response.json().catch(() => null);
    if (isApiErrorBody(rawErrorBody)) {
      throw new ApiClientRequestError({
        code: rawErrorBody.error.code,
        message: rawErrorBody.error.message,
        status: response.status,
        details: rawErrorBody.error.details,
      });
    }
    throw new ApiClientRequestError({
      code: 'HTTP_ERROR',
      message: `Request failed with status ${response.status}`,
      status: response.status,
    });
  }

  const rawBody = (await response.json()) as ApiSuccessBody<T>;
  return rawBody.data;
};

async function publicFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, { credentials: 'include' });
  if (!response.ok) return [] as unknown as T;
  const rawBody = (await response.json()) as ApiSuccessBody<T>;
  return rawBody.data;
}

export type TopExpert = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  title: string | null;
  headline: string | null;
  specializations: string[];
  city: string | null;
};

export type TopBusiness = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  companyName: string;
  industry: string | null;
  city: string | null;
};

export type TopCraftsman = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  trade: string | null;
  title: string | null;
  headline: string | null;
  specializations: string[];
  city: string | null;
  workshopName: string | null;
};

async function getPublicProfileFetch(
  userId: string,
  accessToken?: string,
): Promise<PublicUserProfile> {
  const response = await fetchWithAuthRetry(
    `${getApiBaseUrl()}/api/profiles/public/${userId}`,
    {
      method: 'GET',
      credentials: 'include',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
    accessToken,
  );
  if (!response.ok) {
    const raw: unknown = await response.json().catch(() => null);
    if (isApiErrorBody(raw)) {
      throw new ApiClientRequestError({
        code: raw.error.code,
        message: raw.error.message,
        status: response.status,
        details: raw.error.details,
      });
    }
    throw new ApiClientRequestError({
      code: 'HTTP_ERROR',
      message: `Request failed with status ${response.status}`,
      status: response.status,
    });
  }
  const rawBody = (await response.json()) as ApiSuccessBody<unknown>;
  return parsePublicUserProfile(rawBody.data);
}

/** Browser-side defence in depth for the public profile response. */
export const parsePublicUserProfile = (value: unknown): PublicUserProfile =>
  sanitizePublicUserProfile(value);

export const profilesApiClient = {
  getTopExperts: () => publicFetch<TopExpert[]>('/api/profiles/top-experts'),
  getTopCraftsmen: () => publicFetch<TopCraftsman[]>('/api/profiles/top-craftsmen'),
  getTopBusinesses: () => publicFetch<TopBusiness[]>('/api/profiles/top-businesses'),
  getPublicProfile: getPublicProfileFetch,
  getExpertProfile: (accessToken: string) =>
    apiRequest<ExpertProfile>({ method: 'GET', path: '/api/profiles/expert', accessToken }),

  getCraftsmanProfile: (accessToken: string) =>
    apiRequest<CraftsmanProfile>({
      method: 'GET',
      path: '/api/profiles/craftsman',
      accessToken,
    }),

  updateExpertProfile: (accessToken: string, body: UpdateExpertProfileBody) =>
    apiRequest<ExpertProfile>({ method: 'PATCH', path: '/api/profiles/expert', body, accessToken }),

  updateCraftsmanProfile: (accessToken: string, body: UpdateCraftsmanProfileBody) =>
    apiRequest<CraftsmanProfile>({
      method: 'PATCH',
      path: '/api/profiles/craftsman',
      body,
      accessToken,
    }),

  getCustomerProfile: (accessToken: string) =>
    apiRequest<CustomerProfile>({ method: 'GET', path: '/api/profiles/customer', accessToken }),

  updateCustomerProfile: (accessToken: string, body: UpdateCustomerProfileBody) =>
    apiRequest<CustomerProfile>({
      method: 'PATCH',
      path: '/api/profiles/customer',
      body,
      accessToken,
    }),

  getBusinessProfile: (accessToken: string) =>
    apiRequest<BusinessProfile>({ method: 'GET', path: '/api/profiles/business', accessToken }),

  updateBusinessProfile: (accessToken: string, body: UpdateBusinessProfileBody) =>
    apiRequest<BusinessProfile>({
      method: 'PATCH',
      path: '/api/profiles/business',
      body,
      accessToken,
    }),

  completeBusinessOnboarding: (accessToken: string) =>
    apiRequest<null>({
      method: 'POST',
      path: '/api/profiles/business/complete-onboarding',
      accessToken,
    }),

  completeCraftsmanOnboarding: (accessToken: string) =>
    apiRequest<null>({
      method: 'POST',
      path: '/api/profiles/craftsman/complete-onboarding',
      accessToken,
    }),

  getIdentityDocuments: (accessToken: string) =>
    apiRequest<IdentityDocument[]>({
      method: 'GET',
      path: '/api/profiles/identity-documents',
      accessToken,
    }),

  submitIdentityDocument: (accessToken: string, body: IdentityDocumentBody) =>
    apiRequest<IdentityDocument>({
      method: 'POST',
      path: '/api/profiles/identity-documents',
      body,
      accessToken,
    }),

  withdrawIdentityDocument: (accessToken: string, docId: string) =>
    apiRequest<null>({
      method: 'DELETE',
      path: `/api/profiles/identity-documents/${encodeURIComponent(docId)}`,
      accessToken,
    }),

  getAcademicRecords: (accessToken: string) =>
    apiRequest<AcademicRecord[]>({
      method: 'GET',
      path: '/api/profiles/academic-records',
      accessToken,
    }),

  submitAcademicRecord: (accessToken: string, body: AcademicRecordBody) =>
    apiRequest<AcademicRecord>({
      method: 'POST',
      path: '/api/profiles/academic-records',
      body,
      accessToken,
    }),

  updateAcademicRecord: (
    accessToken: string,
    recordId: string,
    body: Partial<AcademicRecordBody>,
  ) =>
    apiRequest<AcademicRecord>({
      method: 'PATCH',
      path: `/api/profiles/academic-records/${recordId}`,
      body,
      accessToken,
    }),
};
