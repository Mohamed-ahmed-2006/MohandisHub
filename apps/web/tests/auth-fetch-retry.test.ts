import { afterEach, describe, expect, it, vi } from 'vitest';

const coalescedRefreshMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/auth/refresh-coalesced', () => ({
  coalescedRefresh: coalescedRefreshMock,
}));

import { fetchWithAuthRetry } from '../lib/auth/fetch-with-auth-retry';
import { sessionStore } from '../lib/auth/session-store';

const makeResponse = (status: number): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
  }) as Response;

describe('fetchWithAuthRetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    coalescedRefreshMock.mockReset();
    sessionStore.clear();
  });

  it('refreshes once and retries the request with the new access token after a 401', async () => {
    coalescedRefreshMock.mockResolvedValue({
      kind: 'success',
      accessToken: 'new-token',
      expiresIn: 900,
      user: {
        id: 'user-1',
        email: 'user@example.com',
        displayName: 'User',
        role: 'customer',
        isAdmin: false,
        adminPermissions: [],
        plan: 'free',
        emailVerified: true,
        verificationStatus: 'unverified',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(makeResponse(401))
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithAuthRetry(
      'http://localhost:4000/api/wallet/me',
      {
        headers: { Authorization: 'Bearer old-token' },
      },
      'old-token',
    );

    expect(response.status).toBe(200);
    expect(sessionStore.getAccessToken()).toBe('new-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retriedInit = fetchMock.mock.calls[1]?.[1];
    expect(new Headers(retriedInit?.headers).get('Authorization')).toBe('Bearer new-token');
  });
});
