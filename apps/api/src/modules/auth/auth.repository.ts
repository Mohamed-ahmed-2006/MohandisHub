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
      `SELECT u.id, u.email, u.password_hash, u.phone, u.display_name, u.avatar_url,
              u.date_of_birth, u.primary_role, u.plan_id, p.slug AS plan_slug,
              u.email_verified_at, u.phone_verified_at, u.is_active, u.created_at, u.updated_at
       FROM users u
       JOIN plans p ON u.plan_id = p.id
       WHERE u.email = $1 AND u.deleted_at IS NULL
       LIMIT 1`,
      [email.toLowerCase()],
    );
    return rows[0] ?? null;
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT u.id, u.email, u.password_hash, u.phone, u.display_name, u.avatar_url,
              u.date_of_birth, u.primary_role, u.plan_id, p.slug AS plan_slug,
              u.email_verified_at, u.phone_verified_at, u.is_active, u.created_at, u.updated_at
       FROM users u
       JOIN plans p ON u.plan_id = p.id
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
    dateOfBirth: string;
    acceptedTermsAt?: string | undefined;
    termsVersion?: string | undefined;
  }): Promise<UserRow> {
    await this.db.query(
      `INSERT INTO users (email, password_hash, display_name, primary_role, phone, date_of_birth, accepted_terms_at, terms_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8)`,
      [
        params.email.toLowerCase(),
        params.passwordHash,
        params.displayName,
        params.role,
        params.phone ?? null,
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

  // ── Role-specific profile creation (called at registration) ────────────

  async createCustomerProfile(userId: string): Promise<void> {
    await this.db.query('INSERT INTO customer_profiles (user_id) VALUES ($1)', [userId]);
  }

  async createExpertProfile(userId: string): Promise<void> {
    await this.db.query('INSERT INTO expert_profiles (user_id) VALUES ($1)', [userId]);
  }

  async createBusinessProfile(userId: string, companyName: string): Promise<void> {
    await this.db.query(
      `INSERT INTO business_profiles (user_id, company_name) VALUES ($1, $2)`,
      [userId, companyName],
    );
  }

  // ── Verification status lookup ─────────────────────────────────────────

  async getExpertVerification(userId: string): Promise<ExpertVerificationRow | null> {
    const { rows } = await this.db.query<ExpertVerificationRow>(
      'SELECT verification_status FROM expert_profiles WHERE user_id = $1 LIMIT 1',
      [userId],
    );
    return rows[0] ?? null;
  }

  async getBusinessVerification(userId: string): Promise<BusinessVerificationRow | null> {
    const { rows } = await this.db.query<BusinessVerificationRow>(
      'SELECT verification_status FROM business_profiles WHERE user_id = $1 LIMIT 1',
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
