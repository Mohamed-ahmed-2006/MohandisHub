import { afterEach, describe, expect, it } from 'vitest';

import { env } from '../config/env.js';
import { buildTransactionalEmailHtml } from '../utils/transactional-email-template.js';

describe('buildTransactionalEmailHtml', () => {
  const originalLogoUrl = env.EMAIL_LOGO_URL;
  const originalWebPublicUrl = env.WEB_PUBLIC_URL;

  afterEach(() => {
    env.EMAIL_LOGO_URL = originalLogoUrl;
    env.WEB_PUBLIC_URL = originalWebPublicUrl;
  });

  it('uses EMAIL_LOGO_URL when provided', () => {
    env.EMAIL_LOGO_URL = 'https://cdn.example.com/logo.png';
    env.WEB_PUBLIC_URL = 'https://app.example.com';

    const html = buildTransactionalEmailHtml({
      preheader: 'Preheader content',
      title: 'Reset your password',
      greeting: 'Hello Test User,',
      introLines: ['We received a request to reset your password.'],
      action: {
        kind: 'button',
        label: 'Reset Password',
        url: 'https://app.example.com/reset',
      },
      expiryText: 'This link expires in 30 minutes.',
      safetyText: 'If you did not request this, ignore this email.',
    });

    expect(html).toContain('src="https://cdn.example.com/logo.png"');
    expect(html).toContain('Reset Password');
    expect(html).toContain('This link expires in 30 minutes.');
  });

  it('falls back to WEB_PUBLIC_URL logo path when EMAIL_LOGO_URL is missing', () => {
    env.EMAIL_LOGO_URL = undefined;
    env.WEB_PUBLIC_URL = 'https://mohandishub.app';

    const html = buildTransactionalEmailHtml({
      preheader: 'Verification preheader',
      title: 'Verify your email',
      introLines: ['Use the code below to continue.'],
      action: {
        kind: 'code',
        label: 'Verification code',
        value: '654321',
      },
      expiryText: 'This code expires in 10 minutes.',
    });

    expect(html).toContain('src="https://mohandishub.app/brand/mohandishub-email-logo.png"');
    expect(html).toContain('Verification code');
    expect(html).toContain('654321');
    expect(html).toContain('This code expires in 10 minutes.');
  });

  it('falls back to text header when no logo URL can be resolved', () => {
    env.EMAIL_LOGO_URL = undefined;
    env.WEB_PUBLIC_URL = undefined;

    const html = buildTransactionalEmailHtml({
      preheader: 'Preheader fallback',
      title: 'Verify your email',
      introLines: ['Use the code below to continue.'],
      action: {
        kind: 'code',
        label: 'Verification code',
        value: '123456',
      },
    });

    expect(html).not.toContain('<img');
    expect(html).toContain('MohandisHub</div>');
    expect(html).toContain('Verification code');
  });
});
