import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { getPool } from '../../db/pool.js';
import { parsePrivateUploadIdFromUrl } from '../../lib/supabase-storage.js';

import { checkDeleteThresholds, sendRetentionAlert } from './retention.alerts.js';
import { mergeRetentionHours } from './retention.merge.js';
import { RetentionRepository } from './retention.repository.js';
import type { RetentionAlertsJson, RetentionPolicyJson, SweepResults } from './retention.types.js';

const ADVISORY_LOCK_KEY = 912_345_678_901;

export class RetentionService {
  private readonly repo = new RetentionRepository();

  /**
   * Run data retention sweep. Uses advisory lock; returns null if another worker holds the lock.
   */
  async runSweep(options: {
    dryRun: boolean;
    trigger: 'worker' | 'manual';
    clearDryRunFlagAfter?: boolean;
  }): Promise<SweepResults | null> {
    const pool = getPool();
    const lock = await pool.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS locked`,
      [ADVISORY_LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      return null;
    }

    const policyRow = await this.repo.getPolicyAndAlerts();
    let dryRun = options.dryRun;
    let clearDryRunFlag = false;
    if (options.trigger === 'worker' && policyRow?.retention_policy?.dryRunNextScheduled) {
      dryRun = true;
      clearDryRunFlag = true;
    }

    const policy: RetentionPolicyJson = policyRow?.retention_policy ?? {};
    const alerts = policyRow?.retention_alerts ?? {};

    if (policy.masterEnabled === false) {
      await pool.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]);
      return {
        _meta: { skipped: true, reason: 'master_disabled' },
      } as SweepResults;
    }

    if (env.RETENTION_UPLOADS_DAYS > 0) {
      logger.warn(
        'RETENTION_UPLOADS_DAYS is set but global upload orphan sweep is not implemented (unsafe); ignoring.',
      );
    }

    const cat = policy.categories ?? {};
    const results: SweepResults = {};

    const logId = await this.repo.insertSweepLogStart(dryRun);
    let errorMsg: string | null = null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const vHours = mergeRetentionHours(
        cat.verificationCodesAfterExpiry,
        env.RETENTION_VERIFICATION_CODES_AFTER_EXPIRY_HOURS,
        'hours',
      );
      if (vHours != null) {
        const n = await this.repo.deleteVerificationCodesAfterExpiryHours(client, vHours, dryRun);
        results.verificationCodesAfterExpiry = { deletedRows: n };
      } else {
        results.verificationCodesAfterExpiry = { skipped: true, reason: 'disabled' };
      }

      const oHours = mergeRetentionHours(
        cat.otpRateLimitWindows,
        env.RETENTION_OTP_RATE_LIMIT_WINDOW_HOURS,
        'hours',
      );
      if (oHours != null) {
        const n = await this.repo.deleteOtpRateLimitsStaleHours(client, oHours, dryRun);
        results.otpRateLimitWindows = { deletedRows: n };
      } else {
        results.otpRateLimitWindows = { skipped: true, reason: 'disabled' };
      }

      const rtHours = mergeRetentionHours(
        cat.refreshTokensAfterExpiry,
        env.RETENTION_REFRESH_TOKENS_AFTER_EXPIRY_DAYS,
        'days',
      );
      if (rtHours != null) {
        const n = await this.repo.deleteRefreshTokensExpiredHours(client, rtHours, dryRun);
        results.refreshTokensAfterExpiry = { deletedRows: n };
      } else {
        results.refreshTokensAfterExpiry = { skipped: true, reason: 'disabled' };
      }

      const vrHours = mergeRetentionHours(
        cat.verificationRequestsTerminal,
        env.RETENTION_VERIFICATION_REQUESTS_DAYS,
        'days',
      );
      if (vrHours != null) {
        const n = await this.repo.deleteVerificationRequestsTerminalHours(client, vrHours, dryRun);
        results.verificationRequestsTerminal = { deletedRows: n };
      } else {
        results.verificationRequestsTerminal = { skipped: true, reason: 'disabled' };
      }

      const dmHours = mergeRetentionHours(cat.dmMessages, env.RETENTION_CHAT_MESSAGES_DAYS, 'days');
      if (dmHours != null) {
        const n = await this.repo.deleteDmMessagesHours(client, dmHours, dryRun);
        results.dmMessages = { deletedRows: n };
      } else {
        results.dmMessages = { skipped: true, reason: 'disabled' };
      }

      const needHours = mergeRetentionHours(
        cat.needReferenceAfterCompleted,
        env.RETENTION_NEED_REFERENCE_DAYS_AFTER_COMPLETED,
        'days',
      );
      if (needHours != null) {
        const rows = await this.repo.listCompletedNeedsWithOldReferences(client, needHours);
        for (const row of rows) {
          await this.repo.clearNeedReferenceUrl(client, row.id, dryRun);
        }
        results.needReferenceAfterCompleted = {
          deletedRows: rows.length,
          deletedFiles: 0,
        };
      } else {
        results.needReferenceAfterCompleted = { skipped: true, reason: 'disabled' };
      }

      const bidHours = mergeRetentionHours(
        cat.bidMessageAttachments,
        env.RETENTION_BID_MESSAGE_ATTACHMENT_DAYS,
        'days',
      );
      if (bidHours != null) {
        const rows = await this.repo.listBidMessagesWithOldAttachments(client, bidHours);
        for (const row of rows) {
          await this.repo.clearBidMessageAttachment(client, row.id, dryRun);
        }
        results.bidMessageAttachments = { deletedRows: rows.length, deletedFiles: 0 };
      } else {
        results.bidMessageAttachments = { skipped: true, reason: 'disabled' };
      }

      const privateUploadHours = mergeRetentionHours(
        cat.verifiedPrivateUploads,
        env.RETENTION_VERIFIED_PRIVATE_UPLOADS_DAYS,
        'days',
      );
      if (privateUploadHours != null) {
        const refs = await this.repo.listTerminalKycPrivateUploadReferences(
          client,
          privateUploadHours,
        );
        const identityIds = refs
          .filter((row) => row.source_table === 'identity_documents')
          .map((row) => row.source_id);
        const academicIds = refs
          .filter((row) => row.source_table === 'academic_records')
          .map((row) => row.source_id);
        const privateUploadIds = [
          ...new Set(
            refs.flatMap((row) =>
              row.urls
                .map((url) => (url ? parsePrivateUploadIdFromUrl(url) : null))
                .filter((id): id is string => Boolean(id)),
            ),
          ),
        ];
        const clearedIdentity = await this.repo.clearTerminalIdentityDocumentImages(
          client,
          identityIds,
          dryRun,
        );
        const clearedAcademic = await this.repo.clearTerminalAcademicRecordImages(
          client,
          academicIds,
          dryRun,
        );
        const uploadRows = dryRun
          ? await this.repo.listPrivateUploadsByIds(client, privateUploadIds)
          : await this.repo.listUnreferencedPrivateUploadsByIds(client, privateUploadIds);
        const deletedUploadRows = await this.repo.enqueuePrivateUploadDeletionIfUnreferenced(
          client,
          uploadRows.map((row) => row.id),
          dryRun,
        );
        results.verifiedPrivateUploads = {
          deletedRows: clearedIdentity + clearedAcademic + deletedUploadRows,
          deletedFiles: 0,
        };
      } else {
        results.verifiedPrivateUploads = { skipped: true, reason: 'disabled' };
      }

      const unverifiedHours = mergeRetentionHours(
        cat.unverifiedAccounts,
        env.RETENTION_UNVERIFIED_ACCOUNTS_DAYS,
        'days',
      );
      if (unverifiedHours != null) {
        const n = await this.repo.deleteStaleUnverifiedAccountsHours(
          client,
          unverifiedHours,
          dryRun,
        );
        results.unverifiedAccounts = { deletedRows: n };
      } else {
        results.unverifiedAccounts = { skipped: true, reason: 'disabled' };
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      errorMsg = e instanceof Error ? e.message : 'Unknown error';
      logger.error('Retention sweep failed', { error: errorMsg });
    } finally {
      client.release();
      await pool.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]);
    }

    await this.repo.finishSweepLog(logId, results, errorMsg);

    if (clearDryRunFlag && !errorMsg) {
      await this.repo.updatePolicyPatch({ dryRunNextScheduled: false });
    }

    if (errorMsg) {
      void sendRetentionAlert(alerts, {
        type: 'sweep_failed',
        message: errorMsg,
        results,
      });
    } else {
      const thMsg = checkDeleteThresholds(alerts, results);
      if (thMsg) {
        void sendRetentionAlert(alerts, {
          type: 'threshold_exceeded',
          message: thMsg,
          results,
        });
      }
    }

    return results;
  }

  async getPolicyView(): Promise<{
    policy: RetentionPolicyJson;
    alerts: RetentionAlertsJson;
    envSnapshot: Record<string, number>;
    recentLogs: Awaited<ReturnType<RetentionRepository['listSweepLogs']>>;
  }> {
    const row = await this.repo.getPolicyAndAlerts();
    return {
      policy: row?.retention_policy ?? {},
      alerts: row?.retention_alerts ?? {},
      envSnapshot: {
        RETENTION_VERIFICATION_CODES_AFTER_EXPIRY_HOURS:
          env.RETENTION_VERIFICATION_CODES_AFTER_EXPIRY_HOURS,
        RETENTION_OTP_RATE_LIMIT_WINDOW_HOURS: env.RETENTION_OTP_RATE_LIMIT_WINDOW_HOURS,
        RETENTION_REFRESH_TOKENS_AFTER_EXPIRY_DAYS: env.RETENTION_REFRESH_TOKENS_AFTER_EXPIRY_DAYS,
        RETENTION_VERIFICATION_REQUESTS_DAYS: env.RETENTION_VERIFICATION_REQUESTS_DAYS,
        RETENTION_CHAT_MESSAGES_DAYS: env.RETENTION_CHAT_MESSAGES_DAYS,
        RETENTION_NEED_REFERENCE_DAYS_AFTER_COMPLETED:
          env.RETENTION_NEED_REFERENCE_DAYS_AFTER_COMPLETED,
        RETENTION_BID_MESSAGE_ATTACHMENT_DAYS: env.RETENTION_BID_MESSAGE_ATTACHMENT_DAYS,
        RETENTION_VERIFIED_PRIVATE_UPLOADS_DAYS: env.RETENTION_VERIFIED_PRIVATE_UPLOADS_DAYS,
        RETENTION_UNVERIFIED_ACCOUNTS_DAYS: env.RETENTION_UNVERIFIED_ACCOUNTS_DAYS,
      },
      recentLogs: await this.repo.listSweepLogs(20),
    };
  }

  /** Effective retention window in hours per category (null = step disabled). Env is ceiling vs admin. */
  computeEffectiveHours(policy: RetentionPolicyJson): Record<string, number | null> {
    const cat = policy.categories ?? {};
    return {
      verificationCodesAfterExpiry: mergeRetentionHours(
        cat.verificationCodesAfterExpiry,
        env.RETENTION_VERIFICATION_CODES_AFTER_EXPIRY_HOURS,
        'hours',
      ),
      otpRateLimitWindows: mergeRetentionHours(
        cat.otpRateLimitWindows,
        env.RETENTION_OTP_RATE_LIMIT_WINDOW_HOURS,
        'hours',
      ),
      refreshTokensAfterExpiry: mergeRetentionHours(
        cat.refreshTokensAfterExpiry,
        env.RETENTION_REFRESH_TOKENS_AFTER_EXPIRY_DAYS,
        'days',
      ),
      verificationRequestsTerminal: mergeRetentionHours(
        cat.verificationRequestsTerminal,
        env.RETENTION_VERIFICATION_REQUESTS_DAYS,
        'days',
      ),
      dmMessages: mergeRetentionHours(cat.dmMessages, env.RETENTION_CHAT_MESSAGES_DAYS, 'days'),
      needReferenceAfterCompleted: mergeRetentionHours(
        cat.needReferenceAfterCompleted,
        env.RETENTION_NEED_REFERENCE_DAYS_AFTER_COMPLETED,
        'days',
      ),
      bidMessageAttachments: mergeRetentionHours(
        cat.bidMessageAttachments,
        env.RETENTION_BID_MESSAGE_ATTACHMENT_DAYS,
        'days',
      ),
      verifiedPrivateUploads: mergeRetentionHours(
        cat.verifiedPrivateUploads,
        env.RETENTION_VERIFIED_PRIVATE_UPLOADS_DAYS,
        'days',
      ),
    };
  }
}
