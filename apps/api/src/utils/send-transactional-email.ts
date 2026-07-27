// ---------------------------------------------------------------------------
// Shared transactional email sender — used by auth, profiles, etc.
// ---------------------------------------------------------------------------

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';

import { sendResendEmail } from './resend-email.js';
import { buildTransactionalEmailHtml } from './transactional-email-template.js';

export type SendTransactionalEmailParams = {
  to: string;
  displayName?: string;
  subject: string;
  preheader: string;
  title: string;
  greeting?: string;
  introLines: string[];
  action?:
    | { kind: 'button'; label: string; url: string }
    | { kind: 'code'; label: string; value: string };
  expiryText?: string;
  safetyText?: string;
  footerText?: string;
};

export async function sendTransactionalEmail(params: SendTransactionalEmailParams): Promise<void> {
  if (env.OTP_EMAIL_PROVIDER === 'console') {
    logger.info('Transactional email (console)', {
      to: params.to,
      subject: params.subject,
    });
    console.log('\n----------------------------------------');
    console.log('  Transactional email (dev)');
    console.log(`  To:   ${params.to}`);
    console.log(`  Subject: ${params.subject}`);
    console.log('----------------------------------------\n');
    return;
  }

  if (env.OTP_EMAIL_PROVIDER === 'brevo') {
    if (!env.BREVO_API_KEY) {
      throw new Error('Brevo email sender not configured. Set BREVO_API_KEY in .env');
    }

    const htmlContent = buildTransactionalEmailHtml({
      preheader: params.preheader,
      title: params.title,
      introLines: params.introLines,
      ...(params.greeting !== undefined && params.greeting !== '' && { greeting: params.greeting }),
      ...(params.action !== undefined && { action: params.action }),
      ...(params.expiryText !== undefined && { expiryText: params.expiryText }),
      ...(params.safetyText !== undefined && { safetyText: params.safetyText }),
      ...(params.footerText !== undefined && { footerText: params.footerText }),
    });

    const response = await fetchWithTimeout('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { name: 'MohandisHub', email: env.EMAIL_FROM },
        to: [{ email: params.to, name: params.displayName ?? params.to }],
        subject: params.subject,
        htmlContent,
      }),
    });

    if (!response.ok) {
      throw new Error(`Brevo email send failed: ${response.status}`);
    }
    return;
  }

  if (env.OTP_EMAIL_PROVIDER === 'resend') {
    const html = buildTransactionalEmailHtml({
      preheader: params.preheader,
      title: params.title,
      introLines: params.introLines,
      ...(params.greeting !== undefined && params.greeting !== '' && { greeting: params.greeting }),
      ...(params.action !== undefined && { action: params.action }),
      ...(params.expiryText !== undefined && { expiryText: params.expiryText }),
      ...(params.safetyText !== undefined && { safetyText: params.safetyText }),
      ...(params.footerText !== undefined && { footerText: params.footerText }),
    });

    await sendResendEmail({
      to: params.to,
      subject: params.subject,
      html,
    });
    return;
  }

  throw new Error('SendGrid email sender not configured. Set SENDGRID_API_KEY in .env');
}
