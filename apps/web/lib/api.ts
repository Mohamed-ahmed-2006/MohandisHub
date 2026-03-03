import type { HealthResponse } from '@mohandishub/shared';

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
