// ---------------------------------------------------------------------------
// Analytics repository — DB queries for provider analytics
// ---------------------------------------------------------------------------

import { getPool } from '../../db/pool.js';

export type ProviderEarningsRow = { total_earnings: string; currency: string };
export type ProviderViewsRow = { total_views: string };
export type ProviderOrdersRow = { count: string };
export type TopServiceRow = {
  id: string;
  title: string;
  view_count: number;
  order_count: number;
  avg_rating: string | null;
  city?: string | null;
  category_name_en?: string | null;
  category_name_ar?: string | null;
  dispute_count?: string;
  cancellation_count?: string;
  completion_count?: string;
};

export type AnalyticsDateRange = { from: Date; to: Date };

export class AnalyticsRepository {
  async getViewAnalyticsAvailableFrom(providerId: string): Promise<string | null> {
    const { rows } = await getPool().query<{ available_from: string | null }>(
      `SELECT MIN(v.created_at)::text AS available_from
         FROM service_view_events v
         JOIN services s ON s.id = v.service_id
        WHERE s.provider_id = $1`,
      [providerId],
    );
    return rows[0]?.available_from ?? null;
  }

  /** Completed reservation credits earned by the provider. */
  async getProviderEarnings(
    providerId: string,
    range?: AnalyticsDateRange,
  ): Promise<{ totalEarnings: number; currency: string }> {
    const pool = getPool();
    const params: unknown[] = [providerId];
    const dateClause = range
      ? `AND t.created_at >= $${params.push(range.from)} AND t.created_at <= $${params.push(range.to)}`
      : '';
    const { rows } = await pool.query<ProviderEarningsRow>(
      `SELECT COALESCE(SUM(t.balance_delta), 0)::text AS total_earnings,
              COALESCE((SELECT w.currency FROM wallets w WHERE w.user_id = $1 LIMIT 1), 'EGP') AS currency
       FROM transactions t
       JOIN reservations r
         ON t.reference_type = 'reservation' AND t.reference_id = r.id
       WHERE t.user_id = $1
         AND t.type = 'payment'
         AND t.status = 'completed'
         AND t.balance_delta > 0
         AND r.status = 'completed'
       ${dateClause}`,
      params,
    );
    const row = rows[0];
    return {
      totalEarnings: row ? parseFloat(row.total_earnings) : 0,
      currency: row?.currency ?? 'EGP',
    };
  }

  /** Deduplicated service views recorded inside the requested range. */
  async getProviderServiceViews(providerId: string, range: AnalyticsDateRange): Promise<number> {
    const pool = getPool();
    const { rows } = await pool.query<ProviderViewsRow>(
      `SELECT COUNT(*)::text AS total_views
         FROM service_view_events v
         JOIN services s ON s.id = v.service_id
        WHERE s.provider_id = $1 AND v.created_at >= $2 AND v.created_at <= $3`,
      [providerId, range.from, range.to],
    );
    return parseInt(rows[0]?.total_views ?? '0', 10);
  }

  /** Count completed reservations by their completion timestamp. */
  async getProviderOrdersCount(providerId: string, range?: AnalyticsDateRange): Promise<number> {
    const pool = getPool();
    const params: unknown[] = [providerId];
    const dateClause = range
      ? `AND completed_at >= $${params.push(range.from)} AND completed_at <= $${params.push(range.to)}`
      : '';
    const { rows } = await pool.query<ProviderOrdersRow>(
      `SELECT COUNT(*)::text AS count
         FROM reservations
        WHERE provider_id = $1 AND status = 'completed' ${dateClause}`,
      params,
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  /** Top services by view_count + order_count for the provider */
  async getProviderTopServices(
    providerId: string,
    range: AnalyticsDateRange,
    limit: number = 5,
  ): Promise<TopServiceRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<TopServiceRow>(
      `SELECT s.id, s.title,
              count(DISTINCT v.id)::int AS view_count,
              count(DISTINCT r.id)::int AS order_count,
              s.avg_rating::text AS avg_rating
         FROM services s
         LEFT JOIN service_view_events v
           ON v.service_id = s.id AND v.created_at >= $2 AND v.created_at <= $3
         LEFT JOIN reservations r
           ON r.service_id = s.id AND r.status = 'completed'
          AND r.completed_at >= $2 AND r.completed_at <= $3
        WHERE s.provider_id = $1 AND s.status = 'active'
        GROUP BY s.id
        ORDER BY (count(DISTINCT v.id) + count(DISTINCT r.id) * 2) DESC
        LIMIT $4`,
      [providerId, range.from, range.to, limit],
    );
    return rows;
  }

  async getEarningsTrend(providerId: string, range: AnalyticsDateRange) {
    const { rows } = await getPool().query<{ date: string; amount: string }>(
      `SELECT date_trunc('day', transactions.created_at)::date::text AS date,
              COALESCE(SUM(transactions.balance_delta), 0)::text AS amount
       FROM transactions
       JOIN reservations r
         ON transactions.reference_type = 'reservation'
        AND transactions.reference_id = r.id
       WHERE transactions.user_id = $1
         AND transactions.type = 'payment'
         AND transactions.status = 'completed'
         AND transactions.balance_delta > 0
         AND r.status = 'completed'
         AND transactions.created_at >= $2 AND transactions.created_at <= $3
       GROUP BY 1
       ORDER BY 1 ASC`,
      [providerId, range.from, range.to],
    );
    return rows.map((r) => ({ date: r.date, amount: Number(r.amount) }));
  }

  async getOrderTrend(providerId: string, range: AnalyticsDateRange) {
    const { rows } = await getPool().query<{ date: string; count: string }>(
      `SELECT date_trunc('day', completed_at)::date::text AS date,
              count(*)::text AS count
       FROM reservations
       WHERE provider_id = $1 AND status = 'completed'
         AND completed_at >= $2 AND completed_at <= $3
       GROUP BY 1
       ORDER BY 1 ASC`,
      [providerId, range.from, range.to],
    );
    return rows.map((r) => ({ date: r.date, count: parseInt(r.count, 10) || 0 }));
  }

  async getPayoutForecast(providerId: string) {
    const wallet = await getPool().query<{ available: string; currency: string }>(
      `SELECT COALESCE(balance, 0)::text AS available, COALESCE(currency, 'EGP') AS currency
         FROM wallets WHERE user_id = $1 LIMIT 1`,
      [providerId],
    );
    const receivables = await getPool().query<{
      held_amount: string;
      platform_fee: string;
      policy_snapshot: Record<string, unknown>;
      reservation_status: string;
    }>(
      `SELECT h.amount::text AS held_amount,
              r.admin_acceptance_fee::text AS platform_fee,
              r.policy_snapshot,
              r.status AS reservation_status
         FROM reservations r
         JOIN wallet_holds h ON h.id = r.fixed_price_hold_id
        WHERE r.provider_id = $1
          AND r.status IN ('accepted', 'awaiting_start', 'in_session', 'waiting_customer_done', 'disputed')
          AND h.status = 'held'`,
      [providerId],
    );
    const row = wallet.rows[0];
    return {
      available: Number(row?.available ?? 0),
      currency: row?.currency ?? 'EGP',
      receivables: receivables.rows,
    };
  }

  async getServicePerformance(
    providerId: string,
    range: AnalyticsDateRange,
    limit = 20,
  ): Promise<TopServiceRow[]> {
    const { rows } = await getPool().query<TopServiceRow>(
      `SELECT s.id, s.title,
              count(DISTINCT v.id)::int AS view_count,
              count(DISTINCT r.id) FILTER (WHERE r.status = 'completed')::int AS order_count,
              s.avg_rating::text AS avg_rating,
              s.city, c.name_en AS category_name_en, c.name_ar AS category_name_ar,
              count(DISTINCT r.id) FILTER (WHERE r.status = 'disputed')::text AS dispute_count,
              count(DISTINCT r.id) FILTER (WHERE r.status = 'cancelled')::text AS cancellation_count,
              count(DISTINCT r.id) FILTER (WHERE r.status = 'completed')::text AS completion_count
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       LEFT JOIN service_view_events v
         ON v.service_id = s.id AND v.created_at >= $2 AND v.created_at <= $3
       LEFT JOIN reservations r
         ON r.service_id = s.id AND r.created_at >= $2 AND r.created_at <= $3
       WHERE s.provider_id = $1
       GROUP BY s.id, c.name_en, c.name_ar
       ORDER BY order_count DESC NULLS LAST, view_count DESC NULLS LAST
       LIMIT $4`,
      [providerId, range.from, range.to, limit],
    );
    return rows;
  }
}
