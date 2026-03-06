import type { ApiErrorBody, ApiSuccessBody, VerificationStatus } from '@mohandishub/shared';

import { ApiClientRequestError } from '../auth/client';

import { getApiBaseUrl } from '@/lib/env';

type ApiRequestOptions = {
  method: 'GET' | 'POST';
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

export const verificationApiClient = {
  initiate: (accessToken: string, body: { email: string; displayName: string }) =>
    apiRequest<{ requestId: string; redirectUrl?: string; sessionToken?: string }>({
      method: 'POST',
      path: '/api/verification/initiate',
      body,
      accessToken,
    }),

  getStatus: (accessToken: string) =>
    apiRequest<{ verificationStatus: VerificationStatus }>({
      method: 'GET',
      path: '/api/verification/status',
      accessToken,
    }),
};
