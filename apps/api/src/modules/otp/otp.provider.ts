// ---------------------------------------------------------------------------
// OTP delivery providers - abstract interface + concrete adapters
// ---------------------------------------------------------------------------
//
// Strategy pattern: swap between console (dev), SendGrid / Resend (email),
// Twilio / MessageBird (SMS) without changing the service layer.
// ---------------------------------------------------------------------------

import type { OtpChannel } from '@mohandishub/shared';

import { logger } from '../../config/logger.js';
import { sendResendEmail } from '../../utils/resend-email.js';
import { buildTransactionalEmailHtml } from '../../utils/transactional-email-template.js';

/**
 * Abstract interface for sending OTP codes.
 */
export interface IOtpSender {
  readonly channel: OtpChannel;

  /**
   * Send a 6-digit code to the destination.
   * @returns true if sent successfully.
   */
  send(params: { destination: string; code: string; displayName: string }): Promise<boolean>;
}

// -- Console sender (development) -------------------------------------------

export class ConsoleEmailSender implements IOtpSender {
  readonly channel: OtpChannel = 'email';

  send(params: { destination: string; code: string; displayName: string }): Promise<boolean> {
    logger.info('[DEV] Email OTP', {
      to: params.destination,
      code: params.code,
      name: params.displayName,
    });
    console.log('\n----------------------------------------');
    console.log('  Email Verification Code');
    console.log(`  To:   ${params.destination}`);
    console.log(`  Code: ${params.code}`);
    console.log('----------------------------------------\n');
    return Promise.resolve(true);
  }
}

export class ConsoleSmsSender implements IOtpSender {
  readonly channel: OtpChannel = 'phone';

  send(params: { destination: string; code: string; displayName: string }): Promise<boolean> {
    logger.info('[DEV] SMS OTP', {
      to: params.destination,
      code: params.code,
      name: params.displayName,
    });
    console.log('\n----------------------------------------');
    console.log('  SMS Verification Code');
    console.log(`  To:   ${params.destination}`);
    console.log(`  Code: ${params.code}`);
    console.log('----------------------------------------\n');
    return Promise.resolve(true);
  }
}

// -- Brevo email sender (production) ----------------------------------------

export class BrevoEmailSender implements IOtpSender {
  readonly channel: OtpChannel = 'email';

  async send(params: { destination: string; code: string; displayName: string }): Promise<boolean> {
    const { env } = await import('../../config/env.js');

    if (!env.BREVO_API_KEY) {
      throw new Error('Brevo email sender not configured. Set BREVO_API_KEY in .env');
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { name: 'MohandisHub', email: env.EMAIL_FROM },
        to: [{ email: params.destination, name: params.displayName }],
        subject: 'MohandisHub - Verify your email',
        htmlContent: buildTransactionalEmailHtml({
          preheader: 'Your MohandisHub verification code',
          title: 'Verify your email',
          greeting: `Hello ${params.displayName},`,
          introLines: ['Use the verification code below to continue with your sign-in request.'],
          action: {
            kind: 'code',
            label: 'Verification code',
            value: params.code,
          },
          expiryText: 'This code expires in 10 minutes.',
          safetyText: 'If you did not request this code, you can safely ignore this email.',
          footerText: 'For your security, never share this code with anyone.',
        }),
      }),
    });

    if (!response.ok) {
      logger.error('Brevo email send failed', { status: response.status });
      return false;
    }

    return true;
  }
}

// -- Resend email sender (production) ---------------------------------------

export class ResendEmailSender implements IOtpSender {
  readonly channel: OtpChannel = 'email';

  async send(params: { destination: string; code: string; displayName: string }): Promise<boolean> {
    const html = buildTransactionalEmailHtml({
      preheader: 'Your MohandisHub verification code',
      title: 'Verify your email',
      greeting: `Hello ${params.displayName},`,
      introLines: ['Use the verification code below to continue with your sign-in request.'],
      action: {
        kind: 'code',
        label: 'Verification code',
        value: params.code,
      },
      expiryText: 'This code expires in 10 minutes.',
      safetyText: 'If you did not request this code, you can safely ignore this email.',
      footerText: 'For your security, never share this code with anyone.',
    });

    try {
      await sendResendEmail({
        to: params.destination,
        subject: 'MohandisHub - Verify your email',
        html,
      });
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('Resend email sender not configured')
      ) {
        throw error;
      }
      logger.error('Resend email send failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

// -- SendGrid email sender (production stub) --------------------------------

export class SendGridEmailSender implements IOtpSender {
  readonly channel: OtpChannel = 'email';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  send(params: { destination: string; code: string; displayName: string }): Promise<boolean> {
    // SendGrid is blocked in production until this provider is implemented.
    throw new Error('SendGrid email sender not configured. Set SENDGRID_API_KEY in .env');
  }
}

// -- Twilio SMS sender (production stub) ------------------------------------

export class TwilioSmsSender implements IOtpSender {
  readonly channel: OtpChannel = 'phone';

  async send(params: { destination: string; code: string; displayName: string }): Promise<boolean> {
    const { env } = await import('../../config/env.js');
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
      throw new Error('Twilio SMS sender not configured. Set Twilio credentials in .env');
    }
    const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString(
      'base64',
    );
    const body = new URLSearchParams({
      To: params.destination,
      From: env.TWILIO_PHONE_NUMBER,
      Body: `MohandisHub: your verification code is ${params.code}. It expires in 10 minutes.`,
    });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    );
    if (!response.ok) {
      logger.error('Twilio SMS send failed', {
        status: response.status,
      });
      return false;
    }
    return true;
  }
}

export class HttpAdapterSmsSender implements IOtpSender {
  readonly channel: OtpChannel = 'phone';

  async send(params: { destination: string; code: string; displayName: string }): Promise<boolean> {
    const { env } = await import('../../config/env.js');
    if (!env.SMS_HTTP_ENDPOINT || !env.SMS_HTTP_API_KEY) {
      throw new Error(
        'HTTP SMS adapter not configured. Set SMS_HTTP_ENDPOINT and SMS_HTTP_API_KEY.',
      );
    }
    const response = await fetch(env.SMS_HTTP_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SMS_HTTP_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: params.destination,
        from: env.SMS_HTTP_FROM ?? 'MohandisHub',
        body: `MohandisHub: your verification code is ${params.code}. It expires in 10 minutes.`,
        template: 'otp',
        variables: { code: params.code, displayName: params.displayName },
      }),
    });
    if (!response.ok) {
      logger.error('HTTP SMS adapter send failed', {
        status: response.status,
      });
      return false;
    }
    return true;
  }
}

export class MetaWhatsAppOtpSender implements IOtpSender {
  readonly channel: OtpChannel = 'phone';

  async send(params: { destination: string; code: string; displayName: string }): Promise<boolean> {
    const { env } = await import('../../config/env.js');
    if (!env.META_WHATSAPP_TOKEN || !env.META_WHATSAPP_PHONE_NUMBER_ID) {
      throw new Error('Meta WhatsApp sender not configured. Set WhatsApp env keys.');
    }
    const response = await fetch(
      `https://graph.facebook.com/v20.0/${env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.META_WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: params.destination,
          type: 'template',
          template: {
            name: env.META_WHATSAPP_OTP_TEMPLATE,
            language: { code: env.META_WHATSAPP_LANGUAGE },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: params.code }],
              },
            ],
          },
        }),
      },
    );
    if (!response.ok) {
      logger.error('Meta WhatsApp OTP send failed', {
        status: response.status,
      });
      return false;
    }
    return true;
  }
}

// -- Factory -----------------------------------------------------------------

export const createOtpSender = (
  channel: OtpChannel,
  emailProvider: string,
  smsProvider: string,
): IOtpSender => {
  if (channel === 'email') {
    switch (emailProvider) {
      case 'console':
        return new ConsoleEmailSender();
      case 'brevo':
        return new BrevoEmailSender();
      case 'resend':
        return new ResendEmailSender();
      case 'sendgrid':
        return new SendGridEmailSender();
      default:
        throw new Error(`Unknown email OTP provider: ${emailProvider}`);
    }
  }

  switch (smsProvider) {
    case 'console':
      return new ConsoleSmsSender();
    case 'twilio':
      return new TwilioSmsSender();
    case 'http_adapter':
      return new HttpAdapterSmsSender();
    case 'meta_whatsapp':
      return new MetaWhatsAppOtpSender();
    default:
      throw new Error(`Unknown SMS OTP provider: ${smsProvider}`);
  }
};
