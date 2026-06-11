import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usersApiClient } from '../lib/users/client';

describe('usersApiClient.updateAccount', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends avatarUrl in the account update payload', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          data: {
            id: 'user-1',
            email: 'expert@example.com',
            displayName: 'Expert',
            phone: null,
            phoneCode: null,
            nationality: null,
            avatarUrl: 'http://localhost:4000/uploads/avatar.png',
            dateOfBirth: null,
            role: 'expert',
            isAdmin: false,
            adminPermissions: [],
            plan: 'free',
            emailVerified: true,
            verificationStatus: 'under_review',
            createdAt: '2026-03-14T00:00:00.000Z',
          },
        }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await usersApiClient.updateAccount('token-123', {
      avatarUrl: 'http://localhost:4000/uploads/avatar.png',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as [string | URL | Request, RequestInit?] | undefined;
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error('Expected fetch to be called once.');
    }
    const [requestUrl, requestInit] = firstCall;
    expect(requestUrl).toBe('http://localhost:4000/api/users/me');
    expect(requestInit?.method).toBe('PATCH');
    expect(requestInit?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer token-123',
      }),
    );
    expect(requestInit?.body).toBe(
      JSON.stringify({
        avatarUrl: 'http://localhost:4000/uploads/avatar.png',
      }),
    );
  });
});
