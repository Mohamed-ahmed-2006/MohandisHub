import { Resend } from 'resend';

import { env } from '../config/env.js';

type SendResendEmailParams = {
  to: string;
  subject: string;
  html: string;
};

const getResendConfig = (): { apiKey: string; from: string } => {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();

  if (!apiKey) {
    throw new Error('Resend email sender not configured. Set RESEND_API_KEY in .env');
  }
  if (!from) {
    throw new Error('Resend email sender not configured. Set EMAIL_FROM in .env');
  }

  return { apiKey, from };
};

export async function sendResendEmail(params: SendResendEmailParams): Promise<void> {
  const { apiKey, from } = getResendConfig();
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });

  if (error) {
    throw new Error(`Resend email send failed: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error('Resend email send failed: missing email id in response.');
  }
}
