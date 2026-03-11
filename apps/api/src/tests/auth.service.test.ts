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
  const originalBrevoApiKey = env.BREVO_API_KEY;
  const originalEmailFrom = env.EMAIL_FROM;
  const originalEmailLogoUrl = env.EMAIL_LOGO_URL;

  beforeEach(() => {
    env.OTP_EMAIL_PROVIDER = 'console';
    env.WEB_PUBLIC_URL = 'http://localhost:3000';
  });

  afterEach(() => {
    env.OTP_EMAIL_PROVIDER = originalEmailProvider;
    env.WEB_PUBLIC_URL = originalWebPublicUrl;
    env.BREVO_API_KEY = originalBrevoApiKey;
    env.EMAIL_FROM = originalEmailFrom;
    env.EMAIL_LOGO_URL = originalEmailLogoUrl;
    vi.restoreAllMocks();
  });

  it('forgotPassword returns no-account message for unknown email', async () => {
    const repo = createRepositoryMock();
    repo.findUserByEmail.mockResolvedValue(null);

    const service = new AuthService(repo as never);
    const result = await service.forgotPassword({ email: 'missing@example.com' });

    expect(result.message).toContain('No account found');
    expect(repo.setPasswordResetToken).not.toHaveBeenCalled();
  });

  it('forgotPassword returns disabled message for inactive user', async () => {
    const repo = createRepositoryMock();
    repo.findUserByEmail.mockResolvedValue({ ...makeUserRow(), is_active: false });

    const service = new AuthService(repo as never);
    const result = await service.forgotPassword({ email: 'user@example.com' });

    expect(result.message).toContain('disabled');
    expect(repo.setPasswordResetToken).not.toHaveBeenCalled();
  });

  it('forgotPassword stores hashed token and attempts email send for known user', async () => {
    const repo = createRepositoryMock();
    repo.findUserByEmail.mockResolvedValue(makeUserRow());
    repo.setPasswordResetToken.mockResolvedValue(undefined);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const service = new AuthService(repo as never);
    const result = await service.forgotPassword({ email: 'user@example.com' });

    expect(result.message).toContain('password reset link has been sent');
    expect(repo.setPasswordResetToken).toHaveBeenCalledTimes(1);

    const callArgs = repo.setPasswordResetToken.mock.calls[0] as [string, string, Date];
    expect(callArgs[0]).toBe('usr_123');
    expect(callArgs[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(callArgs[2]).toBeInstanceOf(Date);
    expect(callArgs[2].getTime()).toBeGreaterThan(Date.now());
    expect(logSpy).toHaveBeenCalled();
    expect(result.devResetLink).toBeDefined();
  });

  it('forgotPassword returns send-failed message when email sending fails', async () => {
    const repo = createRepositoryMock();
    repo.findUserByEmail.mockResolvedValue(makeUserRow());
    repo.setPasswordResetToken.mockResolvedValue(undefined);

    env.OTP_EMAIL_PROVIDER = 'sendgrid';

    const service = new AuthService(repo as never);
    const result = await service.forgotPassword({ email: 'user@example.com' });

    expect(result.message).toContain('could not send');
    expect(repo.setPasswordResetToken).toHaveBeenCalledTimes(1);
  });

  it('forgotPassword sends branded Brevo HTML when Brevo is configured', async () => {
    const repo = createRepositoryMock();
    repo.findUserByEmail.mockResolvedValue(makeUserRow());
    repo.setPasswordResetToken.mockResolvedValue(undefined);

    env.OTP_EMAIL_PROVIDER = 'brevo';
    env.BREVO_API_KEY = 'brevo_test_key';
    env.EMAIL_FROM = 'noreply@mohandishub.app';
    env.EMAIL_LOGO_URL = 'https://cdn.example.com/brand/logo.png';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      text: () => Promise.resolve(''),
    } as Response);

    const service = new AuthService(repo as never);
    const result = await service.forgotPassword({ email: 'user@example.com' });

    expect(result.message).toContain('password reset link has been sent');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');

    expect(typeof init.body).toBe('string');
    const payload = JSON.parse(init.body as string) as {
      subject: string;
      htmlContent: string;
    };

    expect(payload.subject).toContain('Reset your password');
    expect(payload.htmlContent).toContain('Reset your password');
    expect(payload.htmlContent).toContain('Reset Password');
    expect(payload.htmlContent).toContain('If you did not request this');
    expect(payload.htmlContent).toContain('cdn.example.com/brand/logo.png');
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
