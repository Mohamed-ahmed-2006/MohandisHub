// ---------------------------------------------------------------------------
// Verification repository — database access layer
// ---------------------------------------------------------------------------

import type {
  VerificationProvider,
  VerificationRequestStatus,
  VerificationRequestType,
} from '@mohandishub/shared';
import type { Pool } from 'pg';

import { getPool } from '../../db/pool.js';

import type { VerificationRequestRow } from './verification.types.js';

export class VerificationRepository {
  private get db(): Pool {
    return getPool();
  }

  async createRequest(params: {
    userId: string;
    provider: VerificationProvider;
    providerSessionId: string | null;
    requestType: VerificationRequestType;
    expiresAt?: Date;
  }): Promise<VerificationRequestRow> {
    const { rows } = await this.db.query<VerificationRequestRow>(
      `INSERT INTO verification_requests
         (user_id, provider, provider_session_id, request_type, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        params.userId,
        params.provider,
        params.providerSessionId,
        params.requestType,
        params.expiresAt ?? null,
      ],
    );
    return rows[0]!;
  }

  async findById(requestId: string): Promise<VerificationRequestRow | null> {
    const { rows } = await this.db.query<VerificationRequestRow>(
      `SELECT * FROM verification_requests
       WHERE id = $1
       LIMIT 1`,
      [requestId],
    );
    return rows[0] ?? null;
  }

  async findLatestByUserId(userId: string): Promise<VerificationRequestRow | null> {
    const { rows } = await this.db.query<VerificationRequestRow>(
      `SELECT * FROM verification_requests
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async findByProviderSessionId(sessionId: string): Promise<VerificationRequestRow | null> {
    const { rows } = await this.db.query<VerificationRequestRow>(
      `SELECT * FROM verification_requests
       WHERE provider_session_id = $1
       LIMIT 1`,
      [sessionId],
    );
    return rows[0] ?? null;
  }

  /**
   * Get the verification_status from the role-specific profile (used for manual identity flow
   * where admin approves identity_documents and updates profile only, no verification_request).
   */
  async getProfileVerificationStatus(
    userId: string,
    role: 'expert' | 'business' | 'craftsman',
  ): Promise<'unverified' | 'pending' | 'under_review' | 'verified' | 'rejected' | null> {
    const table =
      role === 'expert'
        ? 'expert_profiles'
        : role === 'craftsman'
          ? 'craftsman_profiles'
          : 'business_profiles';
    const { rows } = await this.db.query<{ verification_status: string }>(
      `SELECT verification_status FROM ${table} WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const status = rows[0]?.verification_status;
    if (
      status === 'unverified' ||
      status === 'pending' ||
      status === 'under_review' ||
      status === 'verified' ||
      status === 'rejected'
    ) {
      return status;
    }
    return null;
  }

  async updateStatus(
    requestId: string,
    status: VerificationRequestStatus,
    extra?: {
      providerResponse?: unknown;
      reviewerNotes?: string | undefined;
      reviewedBy?: string | undefined;
    },
  ): Promise<void> {
    await this.db.query(
      `UPDATE verification_requests
       SET status = $1,
           provider_response = COALESCE($2, provider_response),
           reviewer_notes = COALESCE($3, reviewer_notes),
           reviewed_by = COALESCE($4, reviewed_by)
       WHERE id = $5`,
      [
        status,
        extra?.providerResponse ? JSON.stringify(extra.providerResponse) : null,
        extra?.reviewerNotes ?? null,
        extra?.reviewedBy ?? null,
        requestId,
      ],
    );
  }

  async transitionStatus(
    requestId: string,
    fromStatuses: VerificationRequestStatus[],
    status: VerificationRequestStatus,
    extra?: { providerResponse?: unknown },
  ): Promise<boolean> {
    const { rows } = await this.db.query<{ id: string }>(
      `UPDATE verification_requests
       SET status = $1,
           provider_response = COALESCE($2, provider_response)
       WHERE id = $3
         AND status::text = ANY($4::text[])
       RETURNING id`,
      [
        status,
        extra?.providerResponse ? JSON.stringify(extra.providerResponse) : null,
        requestId,
        fromStatuses,
      ],
    );
    return rows.length === 1;
  }

  async applyTerminalOutcome(params: {
    requestId: string;
    status: 'approved' | 'rejected';
    providerResponse?: unknown;
    reviewerNotes?: string;
    reviewedBy?: string;
    role: 'expert' | 'business' | 'craftsman';
    profileStatus: 'under_review' | 'verified' | 'rejected';
    identityApproved: boolean;
    identityVerificationMethod?: 'didit' | 'manual';
    auditAction: 'verification.webhook_result' | 'verification.admin_review';
  }): Promise<boolean> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<VerificationRequestRow>(
        `SELECT * FROM verification_requests WHERE id = $1 FOR UPDATE`,
        [params.requestId],
      );
      const request = locked.rows[0];
      if (!request || !['initiated', 'submitted'].includes(request.status)) {
        await client.query('ROLLBACK');
        return false;
      }

      const requestUpdate = await client.query(
        `UPDATE verification_requests
            SET status = $2,
                provider_response = COALESCE($3::jsonb, provider_response),
                reviewer_notes = COALESCE($4, reviewer_notes),
                reviewed_by = COALESCE($5, reviewed_by)
          WHERE id = $1`,
        [
          params.requestId,
          params.status,
          params.providerResponse ? JSON.stringify(params.providerResponse) : null,
          params.reviewerNotes ?? null,
          params.reviewedBy ?? null,
        ],
      );
      if (requestUpdate.rowCount !== 1) throw new Error('Verification request update failed');

      const table =
        params.role === 'expert'
          ? 'expert_profiles'
          : params.role === 'craftsman'
            ? 'craftsman_profiles'
            : 'business_profiles';
      const methodSql =
        params.role === 'business'
          ? ''
          : `, identity_verification_method = CASE
               WHEN $3 THEN COALESCE($4, identity_verification_method)
               ELSE NULL
             END`;
      const profileUpdate = await client.query(
        `UPDATE ${table}
            SET verification_status = $1,
                verified_at = CASE WHEN $1 = 'verified' THEN now() ELSE NULL END,
                identity_verified = $3
                ${methodSql}
          WHERE user_id = $2`,
        [
          params.profileStatus,
          request.user_id,
          params.identityApproved,
          params.identityVerificationMethod ?? null,
        ],
      );
      if (profileUpdate.rowCount !== 1) {
        throw new Error('Verification profile update failed');
      }

      await client.query(
        `INSERT INTO audit_log (actor_id, action, resource_type, resource_id, details)
         VALUES ($1, $2, 'verification_request', $3, $4::jsonb)`,
        [
          params.reviewedBy ?? null,
          params.auditAction,
          params.requestId,
          JSON.stringify({ approved: params.status === 'approved' }),
        ],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update the verification_status on the user's role-specific profile.
   * Called when a verification is approved or rejected.
   * For experts, when setting to 'verified' also set identity_verified = true and optional identity_verification_method.
   */
  async updateProfileVerificationStatus(
    userId: string,
    role: 'expert' | 'business' | 'craftsman',
    status: 'unverified' | 'pending' | 'under_review' | 'verified' | 'rejected',
    identityVerificationMethod?: 'didit' | 'manual',
  ): Promise<void> {
    const table =
      role === 'expert'
        ? 'expert_profiles'
        : role === 'craftsman'
          ? 'craftsman_profiles'
          : 'business_profiles';
    const verifiedAt = status === 'verified' ? 'now()' : 'NULL';
    const identityVerified =
      status === 'verified'
        ? ', identity_verified = true'
        : status === 'rejected'
          ? ', identity_verified = false'
          : '';
    const methodSet =
      role !== 'business' && status === 'verified' && identityVerificationMethod
        ? ', identity_verification_method = $3'
        : role !== 'business' && status === 'rejected'
          ? ', identity_verification_method = NULL'
          : '';

    const params = identityVerificationMethod
      ? [status, userId, identityVerificationMethod]
      : [status, userId];
    await this.db.query(
      `UPDATE ${table}
       SET verification_status = $1, verified_at = ${verifiedAt}${identityVerified}${methodSet}
       WHERE user_id = $2`,
      params,
    );
  }

  async markIdentityApproved(
    userId: string,
    role: 'expert' | 'business' | 'craftsman',
    identityVerificationMethod?: 'didit' | 'manual',
  ): Promise<void> {
    if (role === 'expert') {
      await this.db.query(
        `UPDATE expert_profiles
         SET identity_verified = true,
             identity_verification_method = COALESCE($2, identity_verification_method)
         WHERE user_id = $1`,
        [userId, identityVerificationMethod ?? null],
      );
      return;
    }

    if (role === 'craftsman') {
      await this.db.query(
        `UPDATE craftsman_profiles
         SET identity_verified = true,
             identity_verification_method = COALESCE($2, identity_verification_method)
         WHERE user_id = $1`,
        [userId, identityVerificationMethod ?? null],
      );
      return;
    }

    await this.db.query(
      `UPDATE business_profiles
       SET identity_verified = true
       WHERE user_id = $1`,
      [userId],
    );
  }
}
