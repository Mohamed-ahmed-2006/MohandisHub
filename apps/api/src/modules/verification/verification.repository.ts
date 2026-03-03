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

  /**
   * Update the verification_status on the user's role-specific profile.
   * Called when a verification is approved or rejected.
   */
  async updateProfileVerificationStatus(
    userId: string,
    role: 'expert' | 'business',
    status: 'unverified' | 'pending' | 'under_review' | 'verified' | 'rejected',
  ): Promise<void> {
    const table = role === 'expert' ? 'expert_profiles' : 'business_profiles';
    const verifiedAt = status === 'verified' ? 'now()' : 'NULL';

    await this.db.query(
      `UPDATE ${table}
       SET verification_status = $1, verified_at = ${verifiedAt}
       WHERE user_id = $2`,
      [status, userId],
    );
  }
}
