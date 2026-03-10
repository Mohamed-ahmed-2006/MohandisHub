// ---------------------------------------------------------------------------
// OTP delivery providers - abstract interface + concrete adapters
// ---------------------------------------------------------------------------
//
// Strategy pattern: swap between console (dev), SendGrid / Resend (email),
// Twilio / MessageBird (SMS) without changing the service layer.
// ---------------------------------------------------------------------------

import type { OtpChannel } from '@mohandishub/shared';

import { logger } from '../../config/logger.js';
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
      const errorText = await response.text();
      logger.error('Brevo email send failed', { status: response.status, body: errorText });
      return false;
    }

    return true;
  }
}

// -- SendGrid email sender (production stub) --------------------------------

export class SendGridEmailSender implements IOtpSender {
  readonly channel: OtpChannel = 'email';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  send(params: { destination: string; code: string; displayName: string }): Promise<boolean> {
    // TODO: Implement with @sendgrid/mail
    throw new Error('SendGrid email sender not configured. Set SENDGRID_API_KEY in .env');
  }
}

// -- Twilio SMS sender (production stub) ------------------------------------

export class TwilioSmsSender implements IOtpSender {
  readonly channel: OtpChannel = 'phone';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  send(params: { destination: string; code: string; displayName: string }): Promise<boolean> {
    // TODO: Implement with twilio
    //
    // import twilio from 'twilio';
    // const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    //
    // await client.messages.create({
    //   to: params.destination,
    //   from: env.TWILIO_PHONE_NUMBER,
    //   body: `MohandisHub: Your verification code is ${params.code}. Expires in 10 minutes.`,
    // });
    // return true;

    throw new Error('Twilio SMS sender not configured. Set TWILIO_ACCOUNT_SID in .env');
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
    default:
      throw new Error(`Unknown SMS OTP provider: ${smsProvider}`);
  }
};
