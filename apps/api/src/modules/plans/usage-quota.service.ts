import type {
  PlanUsageQuotaDef,
  UsageQuotaFeatureKey,
  UsageQuotaPeriodType,
} from '@mohandishub/shared';

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';

export class UsageQuotaService {
  /**
   * Current window for quota accounting. `billing_cycle` uses active subscription [starts_at, ends_at),
   * or calendar month if there is no active subscription (e.g. free plan).
   */
  async resolvePeriodBounds(
    userId: string,
    period: UsageQuotaPeriodType,
  ): Promise<{ start: Date; end: Date }> {
    if (period === 'calendar_month') {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
      return { start, end };
    }

    const pool = getPool();
    const { rows } = await pool.query<{ starts_at: string; ends_at: string }>(
      `SELECT starts_at, ends_at FROM plan_subscriptions
       WHERE user_id = $1 AND ends_at > now()
       ORDER BY ends_at DESC LIMIT 1`,
      [userId],
    );
    if (rows.length > 0) {
      return {
        start: new Date(rows[0]!.starts_at),
        end: new Date(rows[0]!.ends_at),
      };
    }

    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    return { start, end };
  }

  async getCountForWindow(
    userId: string,
    featureKey: UsageQuotaFeatureKey,
    periodStart: Date,
  ): Promise<number> {
    const pool = getPool();
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count::text FROM user_plan_usage_counters
       WHERE user_id = $1 AND feature_key = $2 AND period_start = $3`,
      [userId, featureKey, periodStart.toISOString()],
    );
    if (rows.length === 0) return 0;
    return parseInt(rows[0]!.count, 10) || 0;
  }

  /**
   * Increments metered use after all other validations passed. No-op if `def` is missing.
   */
  async consumeIfConfigured(
    userId: string,
    featureKey: UsageQuotaFeatureKey,
    def?: PlanUsageQuotaDef,
  ) {
    if (!def || def.maxPerPeriod < 1) return;

    const { start, end } = await this.resolvePeriodBounds(userId, def.period);
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string; count: string }>(
        `SELECT id, count::text FROM user_plan_usage_counters
         WHERE user_id = $1 AND feature_key = $2 AND period_start = $3
         FOR UPDATE`,
        [userId, featureKey, start.toISOString()],
      );
      const current = rows[0] ? parseInt(rows[0].count, 10) || 0 : 0;
      if (current >= def.maxPerPeriod) {
        await client.query('ROLLBACK');
        const endsLabel = end.toISOString();
        throw new HttpError({
          statusCode: 403,
          code: 'PLAN_USAGE_QUOTA_EXCEEDED',
          message: `You have reached your plan limit for this action (${def.maxPerPeriod} per ${def.period === 'calendar_month' ? 'calendar month' : 'billing period'}). The current period ends ${endsLabel}.`,
        });
      }
      if (rows.length === 0) {
        await client.query(
          `INSERT INTO user_plan_usage_counters (user_id, feature_key, period_start, period_end, count)
           VALUES ($1, $2, $3, $4, 1)`,
          [userId, featureKey, start.toISOString(), end.toISOString()],
        );
      } else {
        await client.query(
          `UPDATE user_plan_usage_counters SET count = count + 1, updated_at = now(), period_end = $2 WHERE id = $1`,
          [rows[0]!.id, end.toISOString()],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
