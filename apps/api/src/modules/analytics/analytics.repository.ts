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
  /** Total earnings for provider: payment + release transactions, completed */
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
      `SELECT COALESCE(SUM(t.amount), 0)::text AS total_earnings,
              COALESCE((SELECT w.currency FROM wallets w WHERE w.user_id = $1 LIMIT 1), 'EGP') AS currency
       FROM transactions t
       WHERE t.user_id = $1 AND t.type IN ('payment', 'release') AND t.status = 'completed'
       ${dateClause}`,
      params,
    );
    const row = rows[0];
    return {
      totalEarnings: row ? parseFloat(row.total_earnings) : 0,
      currency: row?.currency ?? 'EGP',
    };
  }

  /** Sum of view_count for all services of the provider */
  async getProviderServiceViews(providerId: string): Promise<number> {
    const pool = getPool();
    const { rows } = await pool.query<ProviderViewsRow>(
      `SELECT COALESCE(SUM(view_count), 0)::text AS total_views FROM services WHERE provider_id = $1`,
      [providerId],
    );
    return parseInt(rows[0]?.total_views ?? '0', 10);
  }

  /** Count of reservations where user is the provider */
  async getProviderOrdersCount(providerId: string, range?: AnalyticsDateRange): Promise<number> {
    const pool = getPool();
    const params: unknown[] = [providerId];
    const dateClause = range
      ? `AND created_at >= $${params.push(range.from)} AND created_at <= $${params.push(range.to)}`
      : '';
    const { rows } = await pool.query<ProviderOrdersRow>(
      `SELECT COUNT(*)::text AS count FROM reservations WHERE provider_id = $1 ${dateClause}`,
      params,
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  /** Top services by view_count + order_count for the provider */
  async getProviderTopServices(providerId: string, limit: number = 5): Promise<TopServiceRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<TopServiceRow>(
      `SELECT id, title, view_count, order_count, avg_rating::text AS avg_rating
       FROM services
       WHERE provider_id = $1 AND status = 'active'
       ORDER BY (COALESCE(view_count, 0) + COALESCE(order_count, 0) * 2) DESC
       LIMIT $2`,
      [providerId, limit],
    );
    return rows;
  }

  async getEarningsTrend(providerId: string, range: AnalyticsDateRange) {
    const { rows } = await getPool().query<{ date: string; amount: string }>(
      `SELECT date_trunc('day', created_at)::date::text AS date,
              COALESCE(SUM(amount), 0)::text AS amount
       FROM transactions
       WHERE user_id = $1
         AND type IN ('payment', 'release')
         AND status = 'completed'
         AND created_at >= $2 AND created_at <= $3
       GROUP BY 1
       ORDER BY 1 ASC`,
      [providerId, range.from, range.to],
    );
    return rows.map((r) => ({ date: r.date, amount: Number(r.amount) }));
  }

  async getOrderTrend(providerId: string, range: AnalyticsDateRange) {
    const { rows } = await getPool().query<{ date: string; count: string }>(
      `SELECT date_trunc('day', created_at)::date::text AS date,
              count(*)::text AS count
       FROM reservations
       WHERE provider_id = $1 AND created_at >= $2 AND created_at <= $3
       GROUP BY 1
       ORDER BY 1 ASC`,
      [providerId, range.from, range.to],
    );
    return rows.map((r) => ({ date: r.date, count: parseInt(r.count, 10) || 0 }));
  }

  async getPayoutForecast(providerId: string) {
    const { rows } = await getPool().query<{
      available: string;
      pending: string;
      held: string;
      currency: string;
    }>(
      `SELECT COALESCE(w.balance, 0)::text AS available,
              COALESCE((
                SELECT SUM(amount) FROM transactions
                WHERE user_id = $1 AND status = 'pending'
              ), 0)::text AS pending,
              COALESCE((
                SELECT SUM(amount) FROM wallet_holds
                WHERE user_id = $1 AND status IN ('held', 'open')
              ), 0)::text AS held,
              COALESCE(w.currency, 'EGP') AS currency
       FROM wallets w
       WHERE w.user_id = $1
       LIMIT 1`,
      [providerId],
    );
    const row = rows[0];
    return {
      available: Number(row?.available ?? 0),
      pending: Number(row?.pending ?? 0),
      held: Number(row?.held ?? 0),
      currency: row?.currency ?? 'EGP',
    };
  }

  async getServicePerformance(providerId: string, limit = 20): Promise<TopServiceRow[]> {
    const { rows } = await getPool().query<TopServiceRow>(
      `SELECT s.id, s.title, s.view_count, s.order_count, s.avg_rating::text AS avg_rating,
              s.city, c.name_en AS category_name_en, c.name_ar AS category_name_ar,
              count(r.id) FILTER (WHERE r.status = 'disputed')::text AS dispute_count,
              count(r.id) FILTER (WHERE r.status = 'cancelled')::text AS cancellation_count,
              count(r.id) FILTER (WHERE r.status = 'completed')::text AS completion_count
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       LEFT JOIN reservations r ON r.service_id = s.id
       WHERE s.provider_id = $1
       GROUP BY s.id, c.name_en, c.name_ar
       ORDER BY s.order_count DESC NULLS LAST, s.view_count DESC NULLS LAST
       LIMIT $2`,
      [providerId, limit],
    );
    return rows;
  }
}
