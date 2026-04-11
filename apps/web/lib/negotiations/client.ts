import type {
  ApiErrorBody,
  ApiSuccessBody,
  CreateNegotiationBody,
  NegotiationDetailResponse,
  NegotiationListResponse,
  RespondNegotiationBody,
} from '@mohandishub/shared';

import { ApiClientRequestError } from '@/lib/auth/client';
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
    const rawErrorBody: unknown = await res.json().catch(() => null);
    const maybeError = rawErrorBody as ApiErrorBody | null;
    if (maybeError?.error) {
      throw new ApiClientRequestError({
        code: maybeError.error.code,
        message: maybeError.error.message,
        status: res.status,
        details: maybeError.error.details,
      });
    }
    throw new ApiClientRequestError({
      code: 'HTTP_ERROR',
      message: `Request failed with status ${res.status}`,
      status: res.status,
    });
  }
  const json = (await res.json()) as ApiSuccessBody<T>;
  return json.data;
}

export const negotiationsApiClient = {
  create: (token: string, body: CreateNegotiationBody): Promise<NegotiationDetailResponse> =>
    apiReq('/api/negotiations', token, { method: 'POST', body: JSON.stringify(body) }),

  list: (
    token: string,
    params: {
      role: 'customer' | 'provider';
      status?: string;
      serviceId?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<NegotiationListResponse> => {
    const q = new URLSearchParams();
    q.set('role', params.role);
    if (params.status) q.set('status', params.status);
    if (params.serviceId) q.set('serviceId', params.serviceId);
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    return apiReq(`/api/negotiations?${q.toString()}`, token);
  },

  get: (token: string, id: string): Promise<NegotiationDetailResponse> =>
    apiReq(`/api/negotiations/${id}`, token),

  respond: (token: string, id: string, body: RespondNegotiationBody): Promise<NegotiationDetailResponse> =>
    apiReq(`/api/negotiations/${id}/respond`, token, { method: 'POST', body: JSON.stringify(body) }),

  cancel: (token: string, id: string): Promise<NegotiationDetailResponse> =>
    apiReq(`/api/negotiations/${id}/cancel`, token, { method: 'POST', body: JSON.stringify({}) }),
};
