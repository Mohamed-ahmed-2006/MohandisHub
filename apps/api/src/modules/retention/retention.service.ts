import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { getPool } from '../../db/pool.js';
import { deleteLocalUploadBasenameIfExists } from '../../lib/local-upload-storage.js';
import {
  deleteObjectsFromBucket,
  isSupabaseStorageConfigured,
  resolvePublicUploadRef,
  UPLOADS_BUCKET,
} from '../../lib/supabase-storage.js';

import { checkDeleteThresholds, sendRetentionAlert } from './retention.alerts.js';
import { mergeRetentionHours } from './retention.merge.js';
import { RetentionRepository } from './retention.repository.js';
import type { RetentionAlertsJson, RetentionPolicyJson, SweepResults } from './retention.types.js';
import { parseNeedReferenceUrls } from './retention.urls.js';

const ADVISORY_LOCK_KEY = 912_345_678_901;

export class RetentionService {
  private readonly repo = new RetentionRepository();

  private async deletePublicMediaUrls(urls: string[], dryRun: boolean): Promise<number> {
    if (dryRun) return 0;
    let n = 0;
    const supaPaths: string[] = [];
    for (const url of urls) {
      const ref = resolvePublicUploadRef(url);
      if (!ref) continue;
      if (ref.kind === 'supabase') {
        supaPaths.push(ref.path);
      } else if (deleteLocalUploadBasenameIfExists(ref.basename)) {
        n += 1;
      }
    }
    if (supaPaths.length > 0 && isSupabaseStorageConfigured()) {
      try {
        await deleteObjectsFromBucket(UPLOADS_BUCKET, supaPaths);
        n += supaPaths.length;
      } catch (e) {
        logger.error('Retention: Supabase delete batch failed', {
          error: e instanceof Error ? e.message : 'unknown',
        });
      }
    }
    return n;
  }

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
        let deletedFiles = 0;
        for (const row of rows) {
          const urls = parseNeedReferenceUrls(row.reference_url);
          deletedFiles += await this.deletePublicMediaUrls(urls, dryRun);
          await this.repo.clearNeedReferenceUrl(client, row.id, dryRun);
        }
        results.needReferenceAfterCompleted = {
          deletedRows: rows.length,
          deletedFiles,
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
        let deletedFiles = 0;
        for (const row of rows) {
          const u = row.attachment_url?.trim();
          if (u) {
            deletedFiles += await this.deletePublicMediaUrls([u], dryRun);
          }
          await this.repo.clearBidMessageAttachment(client, row.id, dryRun);
        }
        results.bidMessageAttachments = { deletedRows: rows.length, deletedFiles };
      } else {
        results.bidMessageAttachments = { skipped: true, reason: 'disabled' };
      }

      results.verifiedPrivateUploads = {
        skipped: true,
        reason: 'not_implemented_requires_legal_review',
      };

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
      verifiedPrivateUploads: null,
    };
  }
}
