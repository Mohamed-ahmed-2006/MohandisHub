// ---------------------------------------------------------------------------
// OTP service — business logic for sending & verifying 6-digit codes
// ---------------------------------------------------------------------------

import { createHash, randomInt } from 'node:crypto';

import type { OtpChannel, SendOtpResult, VerifyOtpResult } from '@mohandishub/shared';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../utils/http-error.js';
import { SettingsService } from '../settings/settings.service.js';

import { createOtpSender } from './otp.provider.js';
import { OtpRepository } from './otp.repository.js';

/** Code expires after this many minutes. */
const CODE_TTL_MINUTES = 10;

/** Max codes a user can request per channel per hour. */
const MAX_SENDS_PER_HOUR = 5;

export class OtpService {
  constructor(
    private readonly otpRepo: OtpRepository = new OtpRepository(),
    private readonly settingsService: SettingsService = new SettingsService(),
    private readonly senderFactory: typeof createOtpSender = createOtpSender,
  ) {}

  // ── Send OTP ──────────────────────────────────────────────────────────

  async sendCode(userId: string, channel: OtpChannel): Promise<SendOtpResult> {
    if (channel === 'phone' && env.NODE_ENV === 'production' && env.OTP_SMS_PROVIDER === 'console') {
      throw new HttpError({
        statusCode: 503,
        code: 'PHONE_OTP_UNAVAILABLE',
        message: 'Phone verification is temporarily unavailable.',
      });
    }

    const status = await this.settingsService.getAppStatus();
    if (status.pauseOtpEmails) {
      throw new HttpError({
        statusCode: 503,
        code: 'OTP_PAUSED',
        message: 'Verification emails and OTP are temporarily disabled.',
      });
    }

    // 1. Get user's email / phone
    const user = await this.otpRepo.getUserEmailAndPhone(userId);
    if (!user) {
      throw new HttpError({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    const destination = channel === 'email' ? user.email : user.phone;

    if (!destination) {
      throw new HttpError({
        statusCode: 400,
        code: 'MISSING_DESTINATION',
        message:
          channel === 'email'
            ? 'No email address on file.'
            : 'No phone number on file. Please add a phone number first.',
      });
    }

    // 2. Rate-limit check
    await this.enforceRateLimit(userId, channel);

    // 3. Generate a 6-digit code. Keep any previously delivered code valid
    // until the replacement has actually been delivered.
    const code = this.generateCode();
    const codeHash = this.hashCode(code);
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

    // 4. Persist the candidate code.
    const created = await this.otpRepo.createCode({
      userId,
      channel,
      destination,
      codeHash,
      expiresAt,
    });

    // 5. Send before invalidating the last known-good code or charging quota.
    const sender = this.senderFactory(channel, env.OTP_EMAIL_PROVIDER, env.OTP_SMS_PROVIDER);
    let sent = false;
    try {
      sent = await sender.send({
        destination,
        code,
        displayName: user.display_name,
      });
    } catch {
      sent = false;
    }

    if (!sent) {
      await this.otpRepo.expireCode(created.id);
      logger.error('Failed to send OTP', { channel });
      throw new HttpError({
        statusCode: 502,
        code: 'OTP_SEND_FAILED',
        message: 'Failed to send the verification code. Please try again.',
      });
    }

    // 6. The replacement is deliverable: retire older codes and count the send.
    await this.otpRepo.invalidatePreviousCodes(userId, channel, created.id);
    await this.otpRepo.upsertRateLimit(userId, channel);

    return {
      channel,
      destination: this.maskDestination(destination, channel),
      expiresInSeconds: CODE_TTL_MINUTES * 60,
    };
  }

  // ── Verify OTP ────────────────────────────────────────────────────────

  async verifyCode(userId: string, channel: OtpChannel, code: string): Promise<VerifyOtpResult> {
    // 1. Find the active code
    const activeCode = await this.otpRepo.findActiveCode(userId, channel);

    if (!activeCode) {
      throw new HttpError({
        statusCode: 400,
        code: 'NO_ACTIVE_CODE',
        message: 'No active verification code found. Please request a new one.',
      });
    }

    // 2. Check if code matches
    const inputHash = this.hashCode(code.trim());

    if (inputHash !== activeCode.code_hash) {
      await this.otpRepo.incrementAttempts(activeCode.id);

      const remaining = activeCode.max_attempts - activeCode.attempts - 1;

      if (remaining <= 0) {
        throw new HttpError({
          statusCode: 429,
          code: 'TOO_MANY_ATTEMPTS',
          message: 'Too many incorrect attempts. Please request a new code.',
        });
      }

      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_CODE',
        message: `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      });
    }

    // 3. Mark as verified
    await this.otpRepo.markVerified(activeCode.id);

    // 4. Update the user's verified timestamp
    if (channel === 'email') {
      await this.otpRepo.setEmailVerified(userId);
    } else {
      await this.otpRepo.setPhoneVerified(userId);
    }

    return { channel, verified: true };
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /** Generate a cryptographically random 6-digit code (100000–999999). */
  private generateCode(): string {
    return randomInt(100_000, 1_000_000).toString();
  }

  /** SHA-256 hash a code for safe storage. */
  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /** Mask email/phone for display (e.g. m***d@gmail.com, +20***7890). */
  private maskDestination(dest: string, channel: OtpChannel): string {
    if (channel === 'email') {
      const [local, domain] = dest.split('@');
      if (!local || !domain) return '***@***';
      if (local.length <= 2) return `${local[0]}***@${domain}`;
      return `${local[0]}***${local[local.length - 1]}@${domain}`;
    }

    // Phone: show first 3 and last 4
    if (dest.length <= 7) return '***' + dest.slice(-4);
    return dest.slice(0, 3) + '***' + dest.slice(-4);
  }

  /** Enforce rate limit: max N sends per hour per user+channel. */
  private async enforceRateLimit(userId: string, channel: OtpChannel): Promise<void> {
    const limit = await this.otpRepo.getRateLimit(userId, channel);

    if (!limit) return; // no record yet → first send, allowed

    const windowAge = Date.now() - limit.window_start.getTime();
    const oneHourMs = 60 * 60 * 1000;

    // If the window has expired, the upsert will reset it — allow
    if (windowAge >= oneHourMs) return;

    if (limit.sent_count >= MAX_SENDS_PER_HOUR) {
      const minutesLeft = Math.ceil((oneHourMs - windowAge) / 60_000);
      throw new HttpError({
        statusCode: 429,
        code: 'OTP_RATE_LIMITED',
        message: `Too many verification code requests. Please try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`,
      });
    }
  }
}
