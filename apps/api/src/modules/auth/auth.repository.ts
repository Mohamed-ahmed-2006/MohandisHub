// ---------------------------------------------------------------------------
// Auth repository — database access layer
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

import type { UserRole } from '@mohandishub/shared';
import type { Pool } from 'pg';

import { getPool } from '../../db/pool.js';

import type {
  BusinessVerificationRow,
  ExpertVerificationRow,
  RefreshTokenRow,
  UserRow,
} from './auth.types.js';

export class AuthRepository {
  private get db(): Pool {
    return getPool();
  }

  // ── User CRUD ──────────────────────────────────────────────────────────

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT u.id, u.email, u.password_hash, u.phone, u.phone_code, u.nationality,
              u.display_name, u.avatar_url, u.date_of_birth, u.primary_role,
              COALESCE(u.is_admin, false) AS is_admin,
              u.admin_permissions,
              u.plan_id, COALESCE(p.slug, 'free') AS plan_slug,
              u.email_verified_at, u.phone_verified_at, u.is_active, u.created_at, u.updated_at
       FROM users u
       LEFT JOIN plans p ON u.plan_id = p.id
       WHERE u.email = $1 AND u.deleted_at IS NULL
       LIMIT 1`,
      [email.toLowerCase()],
    );
    return rows[0] ?? null;
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT u.id, u.email, u.password_hash, u.phone, u.phone_code, u.nationality,
              u.display_name, u.avatar_url, u.date_of_birth, u.primary_role,
              COALESCE(u.is_admin, false) AS is_admin,
              u.admin_permissions,
              u.plan_id, COALESCE(p.slug, 'free') AS plan_slug,
              u.email_verified_at, u.phone_verified_at, u.is_active, u.created_at, u.updated_at
       FROM users u
       LEFT JOIN plans p ON u.plan_id = p.id
       WHERE u.id = $1 AND u.deleted_at IS NULL
       LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async createUser(params: {
    email: string;
    passwordHash: string;
    displayName: string;
    role: UserRole;
    phone?: string | undefined;
    phoneCode?: string | undefined;
    nationality?: string | undefined;
    dateOfBirth: string;
    acceptedTermsAt?: string | undefined;
    termsVersion?: string | undefined;
  }): Promise<UserRow> {
    await this.db.query(
      `INSERT INTO users (email, password_hash, display_name, primary_role, phone, phone_code, nationality, date_of_birth, accepted_terms_at, terms_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10)`,
      [
        params.email.toLowerCase(),
        params.passwordHash,
        params.displayName,
        params.role,
        params.phone ?? null,
        params.phoneCode ?? null,
        params.nationality ?? null,
        params.dateOfBirth,
        params.acceptedTermsAt ?? null,
        params.termsVersion ?? null,
      ],
    );
    const created = await this.findUserByEmail(params.email.toLowerCase());
    if (!created) throw new Error('User creation failed');
    return created;
  }

  /** Set last_login_at to now() for the user. */
  async updateLastLoginAt(userId: string): Promise<void> {
    await this.db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  }

  /** Partial update of user account fields. */
  async updateUser(
    userId: string,
    fields: {
      displayName?: string;
      phone?: string | null;
      phoneCode?: string | null;
      nationality?: string | null;
      avatarUrl?: string | null;
      dateOfBirth?: string | null;
    },
  ): Promise<UserRow | null> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (fields.displayName !== undefined) {
      setClauses.push(`display_name = $${idx++}`);
      values.push(fields.displayName);
    }
    if (fields.phone !== undefined) {
      setClauses.push(`phone = $${idx++}`);
      values.push(fields.phone);
    }
    if (fields.phoneCode !== undefined) {
      setClauses.push(`phone_code = $${idx++}`);
      values.push(fields.phoneCode);
    }
    if (fields.nationality !== undefined) {
      setClauses.push(`nationality = $${idx++}`);
      values.push(fields.nationality);
    }
    if (fields.avatarUrl !== undefined) {
      setClauses.push(`avatar_url = $${idx++}`);
      values.push(fields.avatarUrl);
    }
    if (fields.dateOfBirth !== undefined) {
      setClauses.push(`date_of_birth = $${idx++}`);
      values.push(fields.dateOfBirth);
    }

    if (setClauses.length === 0) return this.findUserById(userId);

    values.push(userId);
    await this.db.query(
      `UPDATE users SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${idx} AND deleted_at IS NULL`,
      values,
    );
    return this.findUserById(userId);
  }

  /** Store a pending email change. */
  async setPendingEmail(
    userId: string,
    email: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.db.query(
      `UPDATE users SET pending_email = $1, pending_email_token = $2, pending_email_expires = $3 WHERE id = $4`,
      [email.toLowerCase(), tokenHash, expiresAt, userId],
    );
  }

  /** Get pending email info for a user. */
  async getPendingEmail(userId: string): Promise<{
    pending_email: string;
    pending_email_token: string;
    pending_email_expires: Date;
  } | null> {
    const { rows } = await this.db.query<{
      pending_email: string;
      pending_email_token: string;
      pending_email_expires: Date;
    }>(
      `SELECT pending_email, pending_email_token, pending_email_expires FROM users
       WHERE id = $1 AND pending_email IS NOT NULL AND pending_email_expires > now()`,
      [userId],
    );
    return rows[0] ?? null;
  }

  /** Confirm email change: set email = pending_email, clear pending fields, update email_verified_at. */
  async confirmEmailChange(userId: string): Promise<UserRow | null> {
    await this.db.query(
      `UPDATE users
       SET email = pending_email,
           email_verified_at = now(),
           pending_email = NULL,
           pending_email_token = NULL,
           pending_email_expires = NULL,
           updated_at = now()
       WHERE id = $1 AND pending_email IS NOT NULL`,
      [userId],
    );
    return this.findUserById(userId);
  }

  /** Clear pending email change. */
  async clearPendingEmail(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE users SET pending_email = NULL, pending_email_token = NULL, pending_email_expires = NULL WHERE id = $1`,
      [userId],
    );
  }

  /** Set password reset token hash + expiry for a user. */
  async setPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.db.query(
      `UPDATE users
       SET password_reset_token = $1,
           password_reset_expires = $2
       WHERE id = $3`,
      [tokenHash, expiresAt, userId],
    );
  }

  /** Find a user by active password reset token hash. */
  async findUserByPasswordResetToken(tokenHash: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT u.id, u.email, u.password_hash, u.phone, u.phone_code, u.nationality,
              u.display_name, u.avatar_url, u.date_of_birth, u.primary_role,
              COALESCE(u.is_admin, false) AS is_admin,
              u.admin_permissions,
              u.plan_id, COALESCE(p.slug, 'free') AS plan_slug,
              u.email_verified_at, u.phone_verified_at, u.is_active, u.created_at, u.updated_at
       FROM users u
       LEFT JOIN plans p ON u.plan_id = p.id
       WHERE u.password_reset_token = $1
         AND u.password_reset_expires > now()
         AND u.deleted_at IS NULL
       LIMIT 1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  /** Replace user's password hash. */
  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
      passwordHash,
      userId,
    ]);
  }

  /** Clear password reset fields after successful reset. */
  async clearPasswordResetToken(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE users
       SET password_reset_token = NULL,
           password_reset_expires = NULL
       WHERE id = $1`,
      [userId],
    );
  }

  // ── Role-specific profile creation (called at registration) ────────────

  async createCustomerProfile(userId: string): Promise<void> {
    await this.db.query('INSERT INTO customer_profiles (user_id) VALUES ($1)', [userId]);
  }

  async createExpertProfile(userId: string): Promise<void> {
    await this.db.query('INSERT INTO expert_profiles (user_id) VALUES ($1)', [userId]);
  }

  async createBusinessProfile(userId: string, companyName: string): Promise<void> {
    await this.db.query(`INSERT INTO business_profiles (user_id, company_name) VALUES ($1, $2)`, [
      userId,
      companyName,
    ]);
  }

  // ── Verification status lookup ─────────────────────────────────────────

  async getExpertVerification(userId: string): Promise<ExpertVerificationRow | null> {
    const { rows } = await this.db.query<ExpertVerificationRow>(
      `SELECT verification_status, identity_verified, academic_verified
       FROM expert_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async getBusinessVerification(userId: string): Promise<BusinessVerificationRow | null> {
    const { rows } = await this.db.query<BusinessVerificationRow>(
      `SELECT verification_status, identity_verified, business_verified
       FROM business_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  // ── Refresh tokens ────────────────────────────────────────────────────

  async createRefreshToken(params: {
    userId: string;
    tokenHash: string;
    familyId?: string | undefined;
    deviceInfo?: string | undefined;
    ipAddress?: string | undefined;
    expiresAt: Date;
  }): Promise<RefreshTokenRow> {
    const familyId = params.familyId ?? randomUUID();
    const { rows } = await this.db.query<RefreshTokenRow>(
      `INSERT INTO refresh_tokens (user_id, token_hash, family_id, device_info, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        params.userId,
        params.tokenHash,
        familyId,
        params.deviceInfo ?? null,
        params.ipAddress ?? null,
        params.expiresAt,
      ],
    );
    return rows[0]!;
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
    const { rows } = await this.db.query<RefreshTokenRow>(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       LIMIT 1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  /** Revoke a single refresh token. */
  async revokeRefreshToken(tokenId: string): Promise<void> {
    await this.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [tokenId]);
  }

  /** Revoke ALL tokens in the same family (token-reuse detection). */
  async revokeTokenFamily(familyId: string): Promise<void> {
    await this.db.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
      [familyId],
    );
  }

  /** Revoke all refresh tokens for a user (e.g. password change). */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.db.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
  }
}
