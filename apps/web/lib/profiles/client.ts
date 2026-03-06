import type {
  AcademicRecord,
  AcademicRecordBody,
  ApiErrorBody,
  ApiSuccessBody,
  BusinessProfile,
  ExpertProfile,
  IdentityDocument,
  IdentityDocumentBody,
  UpdateBusinessProfileBody,
  UpdateExpertProfileBody,
} from '@mohandishub/shared';

import { ApiClientRequestError } from '../auth/client';

import { getApiBaseUrl } from '@/lib/env';

type ApiRequestOptions = {
  method: 'GET' | 'POST' | 'PATCH';
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
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

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

export const profilesApiClient = {
  getExpertProfile: (accessToken: string) =>
    apiRequest<ExpertProfile>({ method: 'GET', path: '/api/profiles/expert', accessToken }),

  updateExpertProfile: (accessToken: string, body: UpdateExpertProfileBody) =>
    apiRequest<ExpertProfile>({ method: 'PATCH', path: '/api/profiles/expert', body, accessToken }),

  getBusinessProfile: (accessToken: string) =>
    apiRequest<BusinessProfile>({ method: 'GET', path: '/api/profiles/business', accessToken }),

  updateBusinessProfile: (accessToken: string, body: UpdateBusinessProfileBody) =>
    apiRequest<BusinessProfile>({
      method: 'PATCH',
      path: '/api/profiles/business',
      body,
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
};
