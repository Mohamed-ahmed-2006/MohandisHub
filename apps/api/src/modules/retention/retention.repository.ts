import type { Pool, PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';

import type { RetentionAlertsJson, RetentionPolicyJson } from './retention.types.js';

export type TerminalKycPrivateUploadReference = {
  source_table: 'identity_documents' | 'academic_records';
  source_id: string;
  urls: Array<string | null>;
};

export type RetentionPrivateUploadRow = {
  id: string;
  storage_path: string;
  bucket: string;
};

export class RetentionRepository {
  private get pool(): Pool {
    return getPool();
  }

  async getPolicyAndAlerts(): Promise<{
    retention_policy: RetentionPolicyJson;
    retention_alerts: RetentionAlertsJson;
  } | null> {
    const { rows } = await this.pool.query<{
      retention_policy: RetentionPolicyJson;
      retention_alerts: RetentionAlertsJson;
    }>(`SELECT retention_policy, retention_alerts FROM app_settings LIMIT 1`);
    return rows[0] ?? null;
  }

  async updatePolicyPatch(patch: RetentionPolicyJson): Promise<void> {
    await this.pool.query(
      `UPDATE app_settings SET
         retention_policy = retention_policy || $1::jsonb,
         updated_at = now()
       WHERE id = (SELECT id FROM app_settings LIMIT 1)`,
      [JSON.stringify(patch)],
    );
  }

  async insertSweepLogStart(dryRun: boolean): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO retention_sweep_log (dry_run) VALUES ($1) RETURNING id`,
      [dryRun],
    );
    return rows[0]!.id;
  }

  async finishSweepLog(id: string, results: unknown, error: string | null): Promise<void> {
    await this.pool.query(
      `UPDATE retention_sweep_log SET finished_at = now(), results = $2::jsonb, error = $3 WHERE id = $1`,
      [id, JSON.stringify(results), error],
    );
  }

  async listSweepLogs(limit: number): Promise<
    Array<{
      id: string;
      started_at: Date;
      finished_at: Date | null;
      dry_run: boolean;
      results: unknown;
      error: string | null;
    }>
  > {
    const { rows } = await this.pool.query(
      `SELECT id, started_at, finished_at, dry_run, results, error
       FROM retention_sweep_log ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );
    return rows as Array<{
      id: string;
      started_at: Date;
      finished_at: Date | null;
      dry_run: boolean;
      results: unknown;
      error: string | null;
    }>;
  }

  async listSweepLogsRange(params: { from?: Date; to?: Date; limit: number }): Promise<
    Array<{
      id: string;
      started_at: Date;
      finished_at: Date | null;
      dry_run: boolean;
      results: unknown;
      error: string | null;
    }>
  > {
    const clauses: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (params.from) {
      clauses.push(`started_at >= $${i++}`);
      values.push(params.from);
    }
    if (params.to) {
      clauses.push(`started_at <= $${i++}`);
      values.push(params.to);
    }
    values.push(params.limit);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT id, started_at, finished_at, dry_run, results, error
       FROM retention_sweep_log ${where}
       ORDER BY started_at DESC LIMIT $${i}`,
      values,
    );
    return rows as Array<{
      id: string;
      started_at: Date;
      finished_at: Date | null;
      dry_run: boolean;
      results: unknown;
      error: string | null;
    }>;
  }

  async deleteVerificationCodesAfterExpiryHours(
    client: PoolClient,
    hours: number,
    dryRun: boolean,
  ): Promise<number> {
    if (dryRun) {
      const { rows } = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM verification_codes
         WHERE expires_at < NOW() - ($1::int * INTERVAL '1 hour')`,
        [hours],
      );
      return parseInt(rows[0]?.c ?? '0', 10);
    }
    const { rowCount } = await client.query(
      `DELETE FROM verification_codes
       WHERE expires_at < NOW() - ($1::int * INTERVAL '1 hour')`,
      [hours],
    );
    return rowCount ?? 0;
  }

  /**
   * Hard-delete accounts that never verified their email and are older than the
   * threshold. Never removes admins or any already email-verified account.
   * CASCADE removes the role profile, tokens, etc.
   */
  async deleteStaleUnverifiedAccountsHours(
    client: PoolClient,
    hours: number,
    dryRun: boolean,
  ): Promise<number> {
    const predicate = `email_verified_at IS NULL
         AND deleted_at IS NULL
         AND COALESCE(is_admin, false) = false
         AND created_at < NOW() - ($1::int * INTERVAL '1 hour')`;
    if (dryRun) {
      const { rows } = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM users WHERE ${predicate}`,
        [hours],
      );
      return parseInt(rows[0]?.c ?? '0', 10);
    }
    const { rowCount } = await client.query(`DELETE FROM users WHERE ${predicate}`, [hours]);
    return rowCount ?? 0;
  }

  async deleteOtpRateLimitsStaleHours(
    client: PoolClient,
    hours: number,
    dryRun: boolean,
  ): Promise<number> {
    if (dryRun) {
      const { rows } = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM otp_rate_limits
         WHERE window_start < NOW() - ($1::int * INTERVAL '1 hour')`,
        [hours],
      );
      return parseInt(rows[0]?.c ?? '0', 10);
    }
    const { rowCount } = await client.query(
      `DELETE FROM otp_rate_limits
       WHERE window_start < NOW() - ($1::int * INTERVAL '1 hour')`,
      [hours],
    );
    return rowCount ?? 0;
  }

  async deleteRefreshTokensExpiredHours(
    client: PoolClient,
    hours: number,
    dryRun: boolean,
  ): Promise<number> {
    if (dryRun) {
      const { rows } = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM refresh_tokens
         WHERE expires_at < NOW() - ($1::int * INTERVAL '1 hour')`,
        [hours],
      );
      return parseInt(rows[0]?.c ?? '0', 10);
    }
    const { rowCount } = await client.query(
      `DELETE FROM refresh_tokens
       WHERE expires_at < NOW() - ($1::int * INTERVAL '1 hour')`,
      [hours],
    );
    return rowCount ?? 0;
  }

  async deleteVerificationRequestsTerminalHours(
    client: PoolClient,
    hours: number,
    dryRun: boolean,
  ): Promise<number> {
    if (dryRun) {
      const { rows } = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM verification_requests
         WHERE status IN ('approved','rejected','expired')
           AND created_at < NOW() - ($1::int * INTERVAL '1 hour')`,
        [hours],
      );
      return parseInt(rows[0]?.c ?? '0', 10);
    }
    const { rowCount } = await client.query(
      `DELETE FROM verification_requests
       WHERE status IN ('approved','rejected','expired')
         AND created_at < NOW() - ($1::int * INTERVAL '1 hour')`,
      [hours],
    );
    return rowCount ?? 0;
  }

  async deleteDmMessagesHours(client: PoolClient, hours: number, dryRun: boolean): Promise<number> {
    if (dryRun) {
      const { rows } = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM messages
         WHERE created_at < NOW() - ($1::int * INTERVAL '1 hour')`,
        [hours],
      );
      return parseInt(rows[0]?.c ?? '0', 10);
    }
    const { rowCount } = await client.query(
      `DELETE FROM messages
       WHERE created_at < NOW() - ($1::int * INTERVAL '1 hour')`,
      [hours],
    );
    return rowCount ?? 0;
  }

  async listCompletedNeedsWithOldReferences(
    client: PoolClient,
    hours: number,
  ): Promise<Array<{ id: string; reference_url: string | null }>> {
    const { rows } = await client.query<{ id: string; reference_url: string | null }>(
      `SELECT id, reference_url FROM needs
       WHERE status = 'completed'
         AND reference_url IS NOT NULL
         AND trim(reference_url) <> ''
         AND updated_at < NOW() - ($1::int * INTERVAL '1 hour')`,
      [hours],
    );
    return rows;
  }

  async clearNeedReferenceUrl(client: PoolClient, needId: string, dryRun: boolean): Promise<void> {
    if (dryRun) return;
    await client.query(`UPDATE needs SET reference_url = NULL, updated_at = now() WHERE id = $1`, [
      needId,
    ]);
  }

  async listBidMessagesWithOldAttachments(
    client: PoolClient,
    hours: number,
  ): Promise<Array<{ id: string; attachment_url: string | null }>> {
    const { rows } = await client.query<{ id: string; attachment_url: string | null }>(
      `SELECT id, attachment_url FROM bid_messages
       WHERE attachment_url IS NOT NULL
         AND trim(attachment_url) <> ''
         AND created_at < NOW() - ($1::int * INTERVAL '1 hour')`,
      [hours],
    );
    return rows;
  }

  async clearBidMessageAttachment(
    client: PoolClient,
    messageId: string,
    dryRun: boolean,
  ): Promise<void> {
    if (dryRun) return;
    await client.query(`UPDATE bid_messages SET attachment_url = NULL WHERE id = $1`, [messageId]);
  }

  async listTerminalKycPrivateUploadReferences(
    client: PoolClient,
    hours: number,
  ): Promise<TerminalKycPrivateUploadReference[]> {
    const { rows } = await client.query<TerminalKycPrivateUploadReference>(
      `SELECT 'identity_documents'::text AS source_table,
              id AS source_id,
              ARRAY[front_image_url, back_image_url, selfie_image_url] AS urls
         FROM identity_documents
        WHERE status IN ('approved', 'rejected', 'expired')
          AND COALESCE(reviewed_at, updated_at, created_at) < NOW() - ($1::int * INTERVAL '1 hour')
          AND (
            front_image_url LIKE '%/api/upload/private/%'
            OR back_image_url LIKE '%/api/upload/private/%'
            OR selfie_image_url LIKE '%/api/upload/private/%'
          )
       UNION ALL
       SELECT 'academic_records'::text AS source_table,
              id AS source_id,
              ARRAY[certificate_image_url, transcript_image_url] AS urls
         FROM academic_records
        WHERE status IN ('approved', 'rejected')
          AND COALESCE(reviewed_at, updated_at, created_at) < NOW() - ($1::int * INTERVAL '1 hour')
          AND (
            certificate_image_url LIKE '%/api/upload/private/%'
            OR transcript_image_url LIKE '%/api/upload/private/%'
          )`,
      [hours],
    );
    return rows;
  }

  async listPrivateUploadsByIds(
    client: PoolClient,
    ids: string[],
  ): Promise<RetentionPrivateUploadRow[]> {
    if (ids.length === 0) return [];
    const { rows } = await client.query<RetentionPrivateUploadRow>(
      `SELECT id, storage_path, bucket
         FROM private_uploads
        WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return rows;
  }

  async clearTerminalIdentityDocumentImages(
    client: PoolClient,
    ids: string[],
    dryRun: boolean,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    if (dryRun) return ids.length;
    const { rowCount } = await client.query(
      `UPDATE identity_documents
          SET front_image_url = NULL,
              back_image_url = NULL,
              selfie_image_url = NULL,
              updated_at = now()
        WHERE id = ANY($1::uuid[])
          AND status IN ('approved', 'rejected', 'expired')`,
      [ids],
    );
    return rowCount ?? 0;
  }

  async clearTerminalAcademicRecordImages(
    client: PoolClient,
    ids: string[],
    dryRun: boolean,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    if (dryRun) return ids.length;
    const { rowCount } = await client.query(
      `UPDATE academic_records
          SET certificate_image_url = NULL,
              transcript_image_url = NULL,
              updated_at = now()
        WHERE id = ANY($1::uuid[])
          AND status IN ('approved', 'rejected')`,
      [ids],
    );
    return rowCount ?? 0;
  }

  async deletePrivateUploadsIfUnreferenced(
    client: PoolClient,
    ids: string[],
    dryRun: boolean,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const sql = `
      FROM private_uploads pu
      WHERE pu.id = ANY($1::uuid[])
        AND NOT EXISTS (
          SELECT 1 FROM identity_documents d
           WHERE d.front_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
              OR d.back_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
              OR d.selfie_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
        )
        AND NOT EXISTS (
          SELECT 1 FROM academic_records a
           WHERE a.certificate_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
              OR a.transcript_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
        )
        AND NOT EXISTS (
          SELECT 1 FROM job_applications ja
           WHERE ja.cv_file_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
        )
        AND NOT EXISTS (
          SELECT 1 FROM deposit_requests dr
           WHERE dr.proof_upload_id = pu.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM withdrawal_requests wr
           WHERE wr.admin_proof_upload_id = pu.id
        )`;
    if (dryRun) {
      const { rows } = await client.query<{ c: string }>(`SELECT count(*)::text AS c ${sql}`, [
        ids,
      ]);
      return parseInt(rows[0]?.c ?? '0', 10);
    }
    const { rowCount } = await client.query(`DELETE ${sql}`, [ids]);
    return rowCount ?? 0;
  }

  async listUnreferencedPrivateUploadsByIds(
    client: PoolClient,
    ids: string[],
  ): Promise<RetentionPrivateUploadRow[]> {
    if (ids.length === 0) return [];
    const { rows } = await client.query<RetentionPrivateUploadRow>(
      `SELECT pu.id, pu.storage_path, pu.bucket
         FROM private_uploads pu
        WHERE pu.id = ANY($1::uuid[])
          AND NOT EXISTS (
            SELECT 1 FROM identity_documents d
             WHERE d.front_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
                OR d.back_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
                OR d.selfie_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
          )
          AND NOT EXISTS (
            SELECT 1 FROM academic_records a
             WHERE a.certificate_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
                OR a.transcript_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
          )
          AND NOT EXISTS (
            SELECT 1 FROM job_applications ja
             WHERE ja.cv_file_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
          )
          AND NOT EXISTS (
            SELECT 1 FROM deposit_requests dr
             WHERE dr.proof_upload_id = pu.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM withdrawal_requests wr
             WHERE wr.admin_proof_upload_id = pu.id
          )`,
      [ids],
    );
    return rows;
  }
}
