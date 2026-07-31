import type {
  BusinessInviteAcceptResult,
  BusinessInvitePreview,
  BusinessTeamOverview,
  BusinessTeamPermission,
  CreateBusinessInviteBody,
  CreateBusinessRoleBody,
  TransferBusinessOwnershipBody,
  UpdateBusinessMemberRoleBody,
} from '@mohandishub/shared';

import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

/**
 * An API failure carrying the backend's stable error code.
 *
 * The acceptance screen has to tell `expired` from `revoked` from
 * `wrong account`, and matching on message text would break the moment a string
 * is reworded or translated. The code is the contract.
 */
export class BusinessTeamApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(params: { code: string; message: string; status: number }) {
    super(params.message);
    this.name = 'BusinessTeamApiError';
    this.code = params.code;
    this.status = params.status;
  }
}

const readError = (body: unknown, status: number): BusinessTeamApiError => {
  const error =
    typeof body === 'object' && body && 'error' in body
      ? (body as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
  return new BusinessTeamApiError({
    code: typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED',
    message:
      typeof error?.message === 'string' ? error.message : `Request failed with status ${status}`,
    status,
  });
};

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
  if (!response.ok) throw readError(body, response.status);
  return (body as { data: T }).data;
};

/**
 * The invitation preview, which is deliberately callable without a session.
 *
 * A recipient who has no account yet still needs to see which workspace invited
 * them before deciding to create one, so this does not go through
 * `fetchWithAuthRetry`. When a session does exist the token is sent, because the
 * backend uses it to answer whether the signed-in account is the invited one.
 */
const publicRequest = async <T>(path: string, accessToken?: string | null): Promise<T> => {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw readError(body, response.status);
  return (body as { data: T }).data;
};

export const BUSINESS_TEAM_PERMISSIONS: BusinessTeamPermission[] = [
  'manage_team',
  'manage_services',
  'manage_jobs',
  'manage_reservations',
  'view_wallet',
  'manage_support_disputes',
  'view_analytics',
];

export const businessTeamsApiClient = {
  getMine: (accessToken: string) =>
    request<BusinessTeamOverview>(accessToken, '/api/business-teams/me'),

  createRole: (accessToken: string, body: CreateBusinessRoleBody) =>
    request<BusinessTeamOverview>(accessToken, '/api/business-teams/roles', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createInvite: (accessToken: string, body: CreateBusinessInviteBody) =>
    request<BusinessTeamOverview>(accessToken, '/api/business-teams/invites', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  revokeInvite: (accessToken: string, inviteId: string) =>
    request<BusinessTeamOverview>(
      accessToken,
      `/api/business-teams/invites/${encodeURIComponent(inviteId)}/revoke`,
      {
        method: 'POST',
      },
    ),

  acceptInvite: (accessToken: string, token: string) =>
    request<BusinessInviteAcceptResult>(accessToken, '/api/business-teams/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  /**
   * Server-side verification of an invitation link.
   *
   * The token travels in the query string because that is where the emailed link
   * puts it. The API logs `req.path`, never the query, so it does not reach a
   * log line — and nothing here writes it to analytics or error reporting.
   */
  previewInvite: (token: string, accessToken?: string | null) =>
    publicRequest<BusinessInvitePreview>(
      `/api/business-teams/invites/preview?token=${encodeURIComponent(token)}`,
      accessToken,
    ),

  updateMemberRole: (accessToken: string, memberId: string, body: UpdateBusinessMemberRoleBody) =>
    request<BusinessTeamOverview>(
      accessToken,
      `/api/business-teams/members/${encodeURIComponent(memberId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  removeMember: (accessToken: string, memberId: string) =>
    request<BusinessTeamOverview>(
      accessToken,
      `/api/business-teams/members/${encodeURIComponent(memberId)}`,
      { method: 'DELETE' },
    ),

  transferOwnership: (accessToken: string, body: TransferBusinessOwnershipBody) =>
    request<BusinessTeamOverview>(accessToken, '/api/business-teams/transfer-ownership', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
