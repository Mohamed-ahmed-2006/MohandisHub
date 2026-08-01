import type {
  AddResolutionCaseEvidenceBody,
  ApiErrorBody,
  ApiSuccessBody,
  CreateResolutionCaseBody,
  EscalateResolutionCaseBody,
  PostResolutionCaseMessageBody,
  ResolutionCaseAvailabilityResponse,
  ResolutionCaseEvidence,
  ResolutionCaseFile,
  ResolutionCaseListResponse,
  ResolutionCaseMessage,
  ResolutionCaseSummary,
} from '@mohandishub/shared';

import { ApiClientRequestError } from '@/lib/auth/client';
import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

/**
 * Errors are surfaced with their server code intact.
 *
 * The centre distinguishes a duplicate case from an unsupported one from a
 * closed one, and each of those has a different thing for the user to do next.
 * Flattening them to a message string would leave the UI guessing from English
 * prose, which does not survive translation.
 */
async function apiReq<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  const res = await fetchWithAuthRetry(
    `${getApiBaseUrl()}${path}`,
    {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts?.headers ?? {}),
      },
      credentials: 'include',
    },
    token,
  );
  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => null);
    const body = raw as ApiErrorBody | null;
    if (body?.error) {
      throw new ApiClientRequestError({
        code: body.error.code,
        message: body.error.message,
        status: res.status,
        ...(body.error.details !== undefined ? { details: body.error.details } : {}),
      });
    }
    throw new ApiClientRequestError({
      code: 'REQUEST_FAILED',
      message: `Request failed (HTTP ${res.status})`,
      status: res.status,
    });
  }
  const json = (await res.json()) as ApiSuccessBody<T>;
  return json.data;
}

export type ListCasesParams = {
  kind?: string[];
  status?: string[];
  search?: string;
  escalated?: boolean;
  page?: number;
  limit?: number;
};

export const helpResolutionApiClient = {
  listCases: (token: string, params: ListCasesParams = {}): Promise<ResolutionCaseListResponse> => {
    const q = new URLSearchParams();
    if (params.kind?.length) q.set('kind', params.kind.join(','));
    if (params.status?.length) q.set('status', params.status.join(','));
    if (params.search) q.set('search', params.search);
    if (params.escalated) q.set('escalated', 'true');
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiReq(`/api/help-resolution/cases${qs ? `?${qs}` : ''}`, token);
  },

  getAvailability: (token: string): Promise<ResolutionCaseAvailabilityResponse> =>
    apiReq('/api/help-resolution/availability', token),

  getCase: (token: string, caseId: string): Promise<ResolutionCaseFile> =>
    apiReq(`/api/help-resolution/cases/${caseId}`, token),

  /** Historical `/app/support?ticketId=…` deep links. */
  getCaseBySupportTicket: (token: string, ticketId: string): Promise<ResolutionCaseSummary> =>
    apiReq(`/api/help-resolution/cases/by-support-ticket/${ticketId}`, token),

  /** Historical `/app/disputes?disputeId=…` deep links. */
  getCaseByReservationDispute: (token: string, disputeId: string): Promise<ResolutionCaseSummary> =>
    apiReq(`/api/help-resolution/cases/by-reservation-dispute/${disputeId}`, token),

  createCase: (token: string, body: CreateResolutionCaseBody): Promise<ResolutionCaseSummary> =>
    apiReq('/api/help-resolution/cases', token, { method: 'POST', body: JSON.stringify(body) }),

  postMessage: (
    token: string,
    caseId: string,
    body: PostResolutionCaseMessageBody,
  ): Promise<ResolutionCaseMessage> =>
    apiReq(`/api/help-resolution/cases/${caseId}/messages`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  addEvidence: (
    token: string,
    caseId: string,
    body: AddResolutionCaseEvidenceBody,
  ): Promise<ResolutionCaseEvidence> =>
    apiReq(`/api/help-resolution/cases/${caseId}/evidence`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  escalate: (
    token: string,
    caseId: string,
    body: EscalateResolutionCaseBody = {},
  ): Promise<ResolutionCaseSummary> =>
    apiReq(`/api/help-resolution/cases/${caseId}/escalate`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
