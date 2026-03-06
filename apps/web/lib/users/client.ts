import type { ApiErrorBody, ApiSuccessBody, AuthUser } from '@mohandishub/shared';

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

export type UpdateAccountBody = {
  displayName?: string;
  phone?: string | null;
  phoneCode?: string | null;
  nationality?: string | null;
  dateOfBirth?: string | null;
};

export type EmailChangeResult = {
  maskedEmail: string;
  expiresInSeconds: number;
};

export const usersApiClient = {
  updateAccount: (accessToken: string, body: UpdateAccountBody) =>
    apiRequest<AuthUser>({ method: 'PATCH', path: '/api/users/me', body, accessToken }),

  requestEmailChange: (accessToken: string, newEmail: string) =>
    apiRequest<EmailChangeResult>({
      method: 'POST',
      path: '/api/users/me/request-email-change',
      body: { newEmail },
      accessToken,
    }),

  confirmEmailChange: (accessToken: string, code: string) =>
    apiRequest<AuthUser>({
      method: 'POST',
      path: '/api/users/me/confirm-email-change',
      body: { code },
      accessToken,
    }),
};
