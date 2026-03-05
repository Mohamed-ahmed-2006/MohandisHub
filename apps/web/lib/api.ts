import type { ApiSuccessBody, HealthResponse, ServicesCatalogResponse } from '@mohandishub/shared';

import { getApiBaseUrl } from './env';

export const fetchApiHealth = async (signal?: AbortSignal): Promise<HealthResponse> => {
  const requestInit: RequestInit = {
    method: 'GET',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  };

  const response = await fetch(`${getApiBaseUrl()}/health`, {
    ...requestInit,
  });

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  const body = (await response.json()) as HealthResponse;

  if (!body.ok) {
    throw new Error('Health response was not ok');
  }

  return body;
};

export const fetchServicesCatalog = async (
  accessToken?: string,
  signal?: AbortSignal,
): Promise<ServicesCatalogResponse> => {
  const headers: Record<string, string> = {};

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${getApiBaseUrl()}/api/services/catalog`, {
    method: 'GET',
    cache: 'no-store',
    headers,
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`Services catalog failed with status ${response.status}`);
  }

  const body = (await response.json()) as ApiSuccessBody<ServicesCatalogResponse>;

  if (!body.ok || !body.data) {
    throw new Error('Services catalog response was not ok');
  }

  return body.data;
};
