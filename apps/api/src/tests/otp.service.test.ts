import { afterEach, describe, expect, it, vi } from 'vitest';

import { env } from '../config/env.js';
import type { IOtpSender } from '../modules/otp/otp.provider.js';
import { OtpService } from '../modules/otp/otp.service.js';

const makeRepo = () => ({
  getUserEmailAndPhone: vi.fn().mockResolvedValue({
    email: 'user@example.com',
    phone: '+201000000000',
    display_name: 'Test User',
  }),
  getRateLimit: vi.fn().mockResolvedValue(null),
  createCode: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }),
  expireCode: vi.fn(),
  invalidatePreviousCodes: vi.fn(),
  upsertRateLimit: vi.fn(),
});

const settings = {
  getAppStatus: vi.fn().mockResolvedValue({ pauseOtpEmails: false }),
};

describe('OtpService delivery ordering', () => {
  const originalNodeEnv = env.NODE_ENV;
  const originalSmsProvider = env.OTP_SMS_PROVIDER;

  afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
    env.OTP_SMS_PROVIDER = originalSmsProvider;
  });

  it('preserves the old code and send quota when replacement delivery fails', async () => {
    const repo = makeRepo();
    const sender: IOtpSender = { channel: 'email', send: vi.fn().mockResolvedValue(false) };
    const service = new OtpService(repo as never, settings as never, () => sender);

    await expect(service.sendCode('user-1', 'email')).rejects.toMatchObject({
      statusCode: 502,
      code: 'OTP_SEND_FAILED',
    });

    expect(repo.expireCode).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(repo.invalidatePreviousCodes).not.toHaveBeenCalled();
    expect(repo.upsertRateLimit).not.toHaveBeenCalled();
  });

  it('retires older codes and charges quota only after successful delivery', async () => {
    const repo = makeRepo();
    const sender: IOtpSender = { channel: 'email', send: vi.fn().mockResolvedValue(true) };
    const service = new OtpService(repo as never, settings as never, () => sender);

    await expect(service.sendCode('user-1', 'email')).resolves.toMatchObject({ channel: 'email' });

    expect(repo.invalidatePreviousCodes).toHaveBeenCalledWith(
      'user-1',
      'email',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(repo.upsertRateLimit).toHaveBeenCalledWith('user-1', 'email');
    expect(repo.expireCode).not.toHaveBeenCalled();
  });

  it('disables console-backed phone OTP in production before creating a code', async () => {
    env.NODE_ENV = 'production';
    env.OTP_SMS_PROVIDER = 'console';
    const repo = makeRepo();
    const service = new OtpService(repo as never, settings as never);

    await expect(service.sendCode('user-1', 'phone')).rejects.toMatchObject({
      statusCode: 503,
      code: 'PHONE_OTP_UNAVAILABLE',
    });
    expect(repo.getUserEmailAndPhone).not.toHaveBeenCalled();
    expect(repo.createCode).not.toHaveBeenCalled();
  });
});
