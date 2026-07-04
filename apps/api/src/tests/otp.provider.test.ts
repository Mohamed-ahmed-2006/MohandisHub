import { afterEach, describe, expect, it, vi } from 'vitest';

import { env } from '../config/env.js';
import { ResendEmailSender } from '../modules/otp/otp.provider.js';

describe('ResendEmailSender', () => {
  const originalResendApiKey = env.RESEND_API_KEY;
  const originalEmailFrom = env.EMAIL_FROM;
  const originalEmailLogoUrl = env.EMAIL_LOGO_URL;
  const originalWebPublicUrl = env.WEB_PUBLIC_URL;

  afterEach(() => {
    env.RESEND_API_KEY = originalResendApiKey;
    env.EMAIL_FROM = originalEmailFrom;
    env.EMAIL_LOGO_URL = originalEmailLogoUrl;
    env.WEB_PUBLIC_URL = originalWebPublicUrl;
    vi.restoreAllMocks();
  });

  it('sends branded OTP HTML payload to Resend', async () => {
    env.RESEND_API_KEY = 'resend_test_key';
    env.EMAIL_FROM = 'MohandisHub <otp@mail.mohandishub.app>';
    env.EMAIL_LOGO_URL = 'https://cdn.example.com/brand/logo.png';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const sender = new ResendEmailSender();
    const sent = await sender.send({
      destination: 'user@example.com',
      code: '112233',
      displayName: 'Test User',
    });

    expect(sent).toBe(true);
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
    expect(payload.subject).toContain('Verify your email');
    expect(payload.html).toContain('Verify your email');
    expect(payload.html).toContain('Verification code');
    expect(payload.html).toContain('112233');
    expect(payload.html).toContain('This code expires in 10 minutes.');
    expect(payload.html).toContain('cdn.example.com/brand/logo.png');
  });
});
