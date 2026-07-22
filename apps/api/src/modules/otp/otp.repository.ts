// ---------------------------------------------------------------------------
// OTP repository — database access layer
// ---------------------------------------------------------------------------

import type { OtpChannel } from '@mohandishub/shared';
import type { Pool } from 'pg';

import { getPool } from '../../db/pool.js';

import type { OtpRateLimitRow, VerificationCodeRow } from './otp.types.js';

export class OtpRepository {
  private get db(): Pool {
    return getPool();
  }

  // ── Verification codes ─────────────────────────────────────────────────

  async createCode(params: {
    userId: string;
    channel: OtpChannel;
    destination: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<VerificationCodeRow> {
    const { rows } = await this.db.query<VerificationCodeRow>(
      `INSERT INTO verification_codes (user_id, channel, destination, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [params.userId, params.channel, params.destination, params.codeHash, params.expiresAt],
    );
    return rows[0]!;
  }

  /**
   * Find the latest unexpired, unverified code for a user + channel.
   */
  async findActiveCode(userId: string, channel: OtpChannel): Promise<VerificationCodeRow | null> {
    const { rows } = await this.db.query<VerificationCodeRow>(
      `SELECT * FROM verification_codes
       WHERE user_id = $1
         AND channel = $2
         AND verified_at IS NULL
         AND expires_at > now()
         AND attempts < max_attempts
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, channel],
    );
    return rows[0] ?? null;
  }

  async incrementAttempts(codeId: string): Promise<void> {
    await this.db.query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [
      codeId,
    ]);
  }

  async markVerified(codeId: string): Promise<void> {
    await this.db.query('UPDATE verification_codes SET verified_at = now() WHERE id = $1', [
      codeId,
    ]);
  }

  /**
   * Make a delivered candidate the sole active code for this user/channel.
   * The candidate may have been expired by another concurrent successful send;
   * reviving it and retiring the other candidates in one statement guarantees
   * that the last completed activation always leaves one delivered code usable.
   */
  async activateDeliveredCode(
    userId: string,
    channel: OtpChannel,
    codeId: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const { rows } = await this.db.query<{ activated: boolean }>(
      `WITH candidate AS (
         SELECT id
         FROM verification_codes
         WHERE id = $3
           AND user_id = $1
           AND channel = $2
           AND verified_at IS NULL
       ), updated AS (
         UPDATE verification_codes v
         SET expires_at = CASE WHEN v.id = $3 THEN $4 ELSE now() END
         WHERE v.user_id = $1
           AND v.channel = $2
           AND v.verified_at IS NULL
           AND EXISTS (SELECT 1 FROM candidate)
         RETURNING v.id
       )
       SELECT EXISTS (SELECT 1 FROM updated WHERE id = $3) AS activated`,
      [userId, channel, codeId, expiresAt],
    );
    return rows[0]?.activated === true;
  }

  async expireCode(codeId: string): Promise<void> {
    await this.db.query(
      `UPDATE verification_codes
       SET expires_at = now()
       WHERE id = $1 AND verified_at IS NULL`,
      [codeId],
    );
  }

  // ── Rate limiting ──────────────────────────────────────────────────────

  async getRateLimit(userId: string, channel: OtpChannel): Promise<OtpRateLimitRow | null> {
    const { rows } = await this.db.query<OtpRateLimitRow>(
      `SELECT * FROM otp_rate_limits WHERE user_id = $1 AND channel = $2 LIMIT 1`,
      [userId, channel],
    );
    return rows[0] ?? null;
  }

  async upsertRateLimit(userId: string, channel: OtpChannel): Promise<void> {
    await this.db.query(
      `INSERT INTO otp_rate_limits (user_id, channel, sent_count, window_start)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (user_id, channel) DO UPDATE
         SET sent_count = CASE
           WHEN otp_rate_limits.window_start < now() - INTERVAL '1 hour'
             THEN 1
             ELSE otp_rate_limits.sent_count + 1
           END,
           window_start = CASE
             WHEN otp_rate_limits.window_start < now() - INTERVAL '1 hour'
               THEN now()
               ELSE otp_rate_limits.window_start
           END`,
      [userId, channel],
    );
  }

  // ── User update helpers ────────────────────────────────────────────────

  async setEmailVerified(userId: string): Promise<void> {
    await this.db.query(
      'UPDATE users SET email_verified_at = now() WHERE id = $1 AND email_verified_at IS NULL',
      [userId],
    );
  }

  async setPhoneVerified(userId: string): Promise<void> {
    await this.db.query(
      'UPDATE users SET phone_verified_at = now() WHERE id = $1 AND phone_verified_at IS NULL',
      [userId],
    );
  }

  async getUserEmailAndPhone(
    userId: string,
  ): Promise<{ email: string; phone: string | null; display_name: string } | null> {
    const { rows } = await this.db.query<{
      email: string;
      phone: string | null;
      display_name: string;
    }>('SELECT email, phone, display_name FROM users WHERE id = $1 LIMIT 1', [userId]);
    return rows[0] ?? null;
  }
}
