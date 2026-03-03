// ---------------------------------------------------------------------------
// OTP delivery providers — abstract interface + concrete adapters
// ---------------------------------------------------------------------------
//
// Strategy pattern: swap between console (dev), SendGrid / Resend (email),
// Twilio / MessageBird (SMS) without changing the service layer.
// ---------------------------------------------------------------------------

import type { OtpChannel } from '@mohandishub/shared';

import { logger } from '../../config/logger.js';

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

// ── Console sender (development) ─────────────────────────────────────────

export class ConsoleEmailSender implements IOtpSender {
  readonly channel: OtpChannel = 'email';

  send(params: { destination: string; code: string; displayName: string }): Promise<boolean> {
    logger.info('📧 [DEV] Email OTP', {
      to: params.destination,
      code: params.code,
      name: params.displayName,
    });
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  📧  Email Verification Code`);
    console.log(`  To:   ${params.destination}`);
    console.log(`  Code: ${params.code}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    return Promise.resolve(true);
  }
}

export class ConsoleSmsSender implements IOtpSender {
  readonly channel: OtpChannel = 'phone';

  send(params: { destination: string; code: string; displayName: string }): Promise<boolean> {
    logger.info('📱 [DEV] SMS OTP', {
      to: params.destination,
      code: params.code,
      name: params.displayName,
    });
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  📱  SMS Verification Code`);
    console.log(`  To:   ${params.destination}`);
    console.log(`  Code: ${params.code}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    return Promise.resolve(true);
  }
}

// ── SendGrid email sender (production stub) ──────────────────────────────

export class SendGridEmailSender implements IOtpSender {
  readonly channel: OtpChannel = 'email';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  send(params: { destination: string; code: string; displayName: string }): Promise<boolean> {
    // TODO: Implement with @sendgrid/mail
    //
    // import sgMail from '@sendgrid/mail';
    // sgMail.setApiKey(env.SENDGRID_API_KEY);
    //
    // await sgMail.send({
    //   to: params.destination,
    //   from: env.EMAIL_FROM,
    //   subject: 'MohandisHub — Verify your email',
    //   html: `
    //     <h2>Hello ${params.displayName},</h2>
    //     <p>Your verification code is: <strong>${params.code}</strong></p>
    //     <p>This code expires in 10 minutes.</p>
    //   `,
    // });
    // return true;

    throw new Error('SendGrid email sender not configured. Set SENDGRID_API_KEY in .env');
  }
}

// ── Twilio SMS sender (production stub) ──────────────────────────────────

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

// ── Factory ─────────────────────────────────────────────────────────────

export const createOtpSender = (
  channel: OtpChannel,
  emailProvider: string,
  smsProvider: string,
): IOtpSender => {
  if (channel === 'email') {
    switch (emailProvider) {
      case 'console':
        return new ConsoleEmailSender();
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
