import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../config/env.js';
import { AuthService } from '../modules/auth/auth.service.js';
import type { UserRow } from '../modules/auth/auth.types.js';

type AuthRepositoryMock = {
  findUserByEmail: ReturnType<typeof vi.fn>;
  setPasswordResetToken: ReturnType<typeof vi.fn>;
  resetPasswordWithToken: ReturnType<typeof vi.fn>;
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
  plan_limits: null,
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
  resetPasswordWithToken: vi.fn(),
  revokeAllUserTokens: vi.fn(),
});

describe('AuthService password reset flow', () => {
  const originalEmailProvider = env.OTP_EMAIL_PROVIDER;
  const originalWebPublicUrl = env.WEB_PUBLIC_URL;
  const originalBrevoApiKey = env.BREVO_API_KEY;
  const originalResendApiKey = env.RESEND_API_KEY;
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
    env.RESEND_API_KEY = originalResendApiKey;
    env.EMAIL_FROM = originalEmailFrom;
    env.EMAIL_LOGO_URL = originalEmailLogoUrl;
    vi.restoreAllMocks();
  });

  it('forgotPassword returns generic message for unknown email', async () => {
    const repo = createRepositoryMock();
    repo.findUserByEmail.mockResolvedValue(null);

    const service = new AuthService(repo as never);
    const result = await service.forgotPassword({ email: 'missing@example.com' });

    expect(result.message).toContain('If your email is registered');
    expect(repo.setPasswordResetToken).not.toHaveBeenCalled();
  });

  it('forgotPassword returns generic message for inactive user', async () => {
    const repo = createRepositoryMock();
    repo.findUserByEmail.mockResolvedValue({ ...makeUserRow(), is_active: false });

    const service = new AuthService(repo as never);
    const result = await service.forgotPassword({ email: 'user@example.com' });

    expect(result.message).toContain('If your email is registered');
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
    expect(result.devResetLink).toContain('/en/auth/reset-password#token=');
    expect(result.devResetLink).not.toContain('reset-password?token=');
  });

  it('forgotPassword does not reveal whether a registered user had a delivery failure', async () => {
    const repo = createRepositoryMock();
    repo.findUserByEmail.mockResolvedValue(makeUserRow());
    repo.setPasswordResetToken.mockResolvedValue(undefined);

    env.OTP_EMAIL_PROVIDER = 'sendgrid';

    const service = new AuthService(repo as never);
    const result = await service.forgotPassword({ email: 'user@example.com' });

    expect(result.message).toBe(
      'If your email is registered, a password reset link has been sent.',
    );
    expect(repo.setPasswordResetToken).toHaveBeenCalledTimes(1);
  });

  it('forgotPassword sends branded Resend HTML when Resend is configured', async () => {
    const repo = createRepositoryMock();
    repo.findUserByEmail.mockResolvedValue(makeUserRow());
    repo.setPasswordResetToken.mockResolvedValue(undefined);

    env.OTP_EMAIL_PROVIDER = 'resend';
    env.RESEND_API_KEY = 'resend_test_key';
    env.EMAIL_FROM = 'MohandisHub <otp@mail.mohandishub.app>';
    env.EMAIL_LOGO_URL = 'https://cdn.example.com/brand/logo.png';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const service = new AuthService(repo as never);
    const result = await service.forgotPassword({ email: 'user@example.com' });

    expect(result.message).toContain('password reset link has been sent');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');

    expect(typeof init.body).toBe('string');
    const payload = JSON.parse(init.body as string) as {
      from: string;
      to: string;
      subject: string;
      html: string;
    };

    expect(payload.from).toBe('MohandisHub <otp@mail.mohandishub.app>');
    expect(payload.to).toBe('user@example.com');
    expect(payload.subject).toContain('Reset your password');
    expect(payload.html).toContain('Reset your password');
    expect(payload.html).toContain('Reset Password');
    expect(payload.html).toContain('If you did not request this');
    expect(payload.html).toContain('cdn.example.com/brand/logo.png');
  });

  it('resetPassword rejects invalid token', async () => {
    const repo = createRepositoryMock();
    repo.resetPasswordWithToken.mockResolvedValue(null);

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

  it('resetPassword atomically consumes the token while updating the password', async () => {
    const repo = createRepositoryMock();
    repo.resetPasswordWithToken.mockResolvedValue('usr_123');
    repo.revokeAllUserTokens.mockResolvedValue(undefined);

    const service = new AuthService(repo as never);
    const result = await service.resetPassword({
      token: 'valid-token-value',
      password: 'ValidPass123',
    });

    expect(result.message).toContain('Password has been reset successfully');
    expect(repo.resetPasswordWithToken).toHaveBeenCalledTimes(1);
    expect(repo.revokeAllUserTokens).toHaveBeenCalledWith('usr_123');

    const [, updatedHash] = repo.resetPasswordWithToken.mock.calls[0] as [string, string];
    await expect(bcrypt.compare('ValidPass123', updatedHash)).resolves.toBe(true);
  });
});
