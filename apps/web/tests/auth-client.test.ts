import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authApiClient } from '../lib/auth/client';

describe('authApiClient password reset endpoints', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls forgot-password endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        await Promise.resolve();
        return {
          ok: true,
          data: {
            message: 'If an account with that email exists, a password reset link has been sent.',
          },
        };
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    await authApiClient.forgotPassword({ email: 'user@example.com' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/auth/forgot-password',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('calls reset-password endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        await Promise.resolve();
        return {
          ok: true,
          data: { message: 'Password has been reset successfully.' },
        };
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    await authApiClient.resetPassword({
      token: 'reset-token',
      password: 'ValidPass123',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/auth/reset-password',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
