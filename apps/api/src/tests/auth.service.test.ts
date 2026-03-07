import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../config/env.js';
import { AuthService } from '../modules/auth/auth.service.js';
import type { UserRow } from '../modules/auth/auth.types.js';

type AuthRepositoryMock = {
  findUserByEmail: ReturnType<typeof vi.fn>;
  setPasswordResetToken: ReturnType<typeof vi.fn>;
  findUserByPasswordResetToken: ReturnType<typeof vi.fn>;
  updatePasswordHash: ReturnType<typeof vi.fn>;
  clearPasswordResetToken: ReturnType<typeof vi.fn>;
  revokeAllUserTokens: ReturnType<typeof vi.fn>;
};

const makeUserRow = (): UserRow => ({
  id: 'usr_123',
  email: 'user@example.com',
  password_hash: '$2a$12$placeholderhashplaceholderhashplaceholderhashplc',
  phone: null,
  phone_code: null,
  nationality: null,
  display_name: 'Test User',
  avatar_url: null,
  date_of_birth: null,
  primary_role: 'customer',
  plan_id: null,
  plan_slug: 'free',
  email_verified_at: null,
  phone_verified_at: null,
  is_active: true,
  is_admin: false,
  created_at: new Date(),
  updated_at: new Date(),
});

const createRepositoryMock = (): AuthRepositoryMock => ({
  findUserByEmail: vi.fn(),
  setPasswordResetToken: vi.fn(),
  findUserByPasswordResetToken: vi.fn(),
  updatePasswordHash: vi.fn(),
  clearPasswordResetToken: vi.fn(),
  revokeAllUserTokens: vi.fn(),
});

describe('AuthService password reset flow', () => {
  const originalEmailProvider = env.OTP_EMAIL_PROVIDER;
  const originalWebPublicUrl = env.WEB_PUBLIC_URL;

  beforeEach(() => {
    env.OTP_EMAIL_PROVIDER = 'console';
    env.WEB_PUBLIC_URL = 'http://localhost:3000';
  });

  afterEach(() => {
    env.OTP_EMAIL_PROVIDER = originalEmailProvider;
    env.WEB_PUBLIC_URL = originalWebPublicUrl;
    vi.restoreAllMocks();
  });

  it('forgotPassword returns generic success for unknown email', async () => {
    const repo = createRepositoryMock();
    repo.findUserByEmail.mockResolvedValue(null);

    const service = new AuthService(repo as never);
    const result = await service.forgotPassword({ email: 'missing@example.com' });

    expect(result.message).toContain('If an account with that email exists');
    expect(repo.setPasswordResetToken).not.toHaveBeenCalled();
  });

  it('forgotPassword stores hashed token and attempts email send for known user', async () => {
    const repo = createRepositoryMock();
    repo.findUserByEmail.mockResolvedValue(makeUserRow());
    repo.setPasswordResetToken.mockResolvedValue(undefined);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const service = new AuthService(repo as never);
    const result = await service.forgotPassword({ email: 'user@example.com' });

    expect(result.message).toContain('If an account with that email exists');
    expect(repo.setPasswordResetToken).toHaveBeenCalledTimes(1);

    const callArgs = repo.setPasswordResetToken.mock.calls[0] as [string, string, Date];
    expect(callArgs[0]).toBe('usr_123');
    expect(callArgs[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(callArgs[2]).toBeInstanceOf(Date);
    expect(callArgs[2].getTime()).toBeGreaterThan(Date.now());
    expect(logSpy).toHaveBeenCalled();
  });

  it('forgotPassword keeps generic response even if email sending fails', async () => {
    const repo = createRepositoryMock();
    repo.findUserByEmail.mockResolvedValue(makeUserRow());
    repo.setPasswordResetToken.mockResolvedValue(undefined);

    env.OTP_EMAIL_PROVIDER = 'sendgrid';

    const service = new AuthService(repo as never);
    const result = await service.forgotPassword({ email: 'user@example.com' });

    expect(result.message).toContain('If an account with that email exists');
    expect(repo.setPasswordResetToken).toHaveBeenCalledTimes(1);
  });

  it('resetPassword rejects invalid token', async () => {
    const repo = createRepositoryMock();
    repo.findUserByPasswordResetToken.mockResolvedValue(null);

    const service = new AuthService(repo as never);

    await expect(
      service.resetPassword({
        token: 'invalid-token-value',
        password: 'ValidPass123',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESET_TOKEN',
    });
  });

  it('resetPassword updates password, clears token and revokes sessions', async () => {
    const repo = createRepositoryMock();
    repo.findUserByPasswordResetToken.mockResolvedValue(makeUserRow());
    repo.updatePasswordHash.mockResolvedValue(undefined);
    repo.clearPasswordResetToken.mockResolvedValue(undefined);
    repo.revokeAllUserTokens.mockResolvedValue(undefined);

    const service = new AuthService(repo as never);
    const result = await service.resetPassword({
      token: 'valid-token-value',
      password: 'ValidPass123',
    });

    expect(result.message).toContain('Password has been reset successfully');
    expect(repo.updatePasswordHash).toHaveBeenCalledTimes(1);
    expect(repo.clearPasswordResetToken).toHaveBeenCalledWith('usr_123');
    expect(repo.revokeAllUserTokens).toHaveBeenCalledWith('usr_123');

    const [, updatedHash] = repo.updatePasswordHash.mock.calls[0] as [string, string];
    await expect(bcrypt.compare('ValidPass123', updatedHash)).resolves.toBe(true);
  });
});
