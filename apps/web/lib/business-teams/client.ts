import type {
  BusinessTeamOverview,
  BusinessTeamPermission,
  CreateBusinessInviteBody,
  CreateBusinessRoleBody,
} from '@mohandishub/shared';

import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

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
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body &&
      'error' in body &&
      typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
        ? (body as { error: { message: string } }).error.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
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
};
