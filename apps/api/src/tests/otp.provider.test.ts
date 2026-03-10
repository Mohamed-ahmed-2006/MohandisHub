import { afterEach, describe, expect, it, vi } from 'vitest';

import { env } from '../config/env.js';
import { BrevoEmailSender } from '../modules/otp/otp.provider.js';

describe('BrevoEmailSender', () => {
  const originalBrevoApiKey = env.BREVO_API_KEY;
  const originalEmailFrom = env.EMAIL_FROM;
  const originalEmailLogoUrl = env.EMAIL_LOGO_URL;
  const originalWebPublicUrl = env.WEB_PUBLIC_URL;

  afterEach(() => {
    env.BREVO_API_KEY = originalBrevoApiKey;
    env.EMAIL_FROM = originalEmailFrom;
    env.EMAIL_LOGO_URL = originalEmailLogoUrl;
    env.WEB_PUBLIC_URL = originalWebPublicUrl;
    vi.restoreAllMocks();
  });

  it('sends branded OTP HTML payload to Brevo', async () => {
    env.BREVO_API_KEY = 'brevo_test_key';
    env.EMAIL_FROM = 'noreply@mohandishub.app';
    env.EMAIL_LOGO_URL = 'https://cdn.example.com/brand/logo.png';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => '',
    } as Response);

    const sender = new BrevoEmailSender();
    const sent = await sender.send({
      destination: 'user@example.com',
      code: '112233',
      displayName: 'Test User',
    });

    expect(sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');

    const payload = JSON.parse(String(init.body)) as {
      subject: string;
      htmlContent: string;
    };

    expect(payload.subject).toContain('Verify your email');
    expect(payload.htmlContent).toContain('Verify your email');
    expect(payload.htmlContent).toContain('Verification code');
    expect(payload.htmlContent).toContain('112233');
    expect(payload.htmlContent).toContain('This code expires in 10 minutes.');
    expect(payload.htmlContent).toContain('cdn.example.com/brand/logo.png');
  });
});
