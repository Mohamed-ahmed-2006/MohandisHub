import type {
  BusinessInviteAcceptResult,
  BusinessInvitePreview,
  BusinessTeamOverview,
  BusinessTeamPermission,
  BusinessWorkspaceList,
  CreateBusinessInviteBody,
  CreateBusinessRoleBody,
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

/**
 * Permissions a custom role can be given.
 *
 * Exactly the set the backend enforces. The other six values the schema accepts
 * are still stored on roles that already carry them and are reported separately
 * as reserved, but offering them here would be offering capabilities the API
 * ignores — which is what the previous version of this screen did.
 */
export const BUSINESS_TEAM_PERMISSIONS: BusinessTeamPermission[] = ['manage_team'];

/** Appends `?teamId=` when a workspace has been selected. */
const withTeam = (path: string, teamId?: string | null): string =>
  teamId ? `${path}${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(teamId)}` : path;

export const businessTeamsApiClient = {
  /** Every workspace this account can open, regardless of its primary role. */
  listWorkspaces: (accessToken: string) =>
    request<BusinessWorkspaceList>(accessToken, '/api/business-teams/workspaces'),

  getMine: (accessToken: string, teamId?: string | null) =>
    request<BusinessTeamOverview>(accessToken, withTeam('/api/business-teams/me', teamId)),

  createRole: (accessToken: string, body: CreateBusinessRoleBody, teamId?: string | null) =>
    request<BusinessTeamOverview>(accessToken, withTeam('/api/business-teams/roles', teamId), {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createInvite: (accessToken: string, body: CreateBusinessInviteBody, teamId?: string | null) =>
    request<BusinessTeamOverview>(accessToken, withTeam('/api/business-teams/invites', teamId), {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  revokeInvite: (accessToken: string, inviteId: string, teamId?: string | null) =>
    request<BusinessTeamOverview>(
      accessToken,
      withTeam(`/api/business-teams/invites/${encodeURIComponent(inviteId)}/revoke`, teamId),
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

  updateMemberRole: (
    accessToken: string,
    memberId: string,
    body: UpdateBusinessMemberRoleBody,
    teamId?: string | null,
  ) =>
    request<BusinessTeamOverview>(
      accessToken,
      withTeam(`/api/business-teams/members/${encodeURIComponent(memberId)}`, teamId),
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  removeMember: (accessToken: string, memberId: string, teamId?: string | null) =>
    request<BusinessTeamOverview>(
      accessToken,
      withTeam(`/api/business-teams/members/${encodeURIComponent(memberId)}`, teamId),
      { method: 'DELETE' },
    ),
};

// Ownership transfer has no client method. The endpoint still exists and always
// answers OWNERSHIP_TRANSFER_NOT_AVAILABLE; there is nothing here to call it
// with, because moving the Owner membership would move team administration
// while every service, job, advertisement, booking and ledger row stayed with
// the original account.
