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
};

export class AnalyticsRepository {
  /** Total earnings for provider: payment + release transactions, completed */
  async getProviderEarnings(providerId: string): Promise<{ totalEarnings: number; currency: string }> {
    const pool = getPool();
    const { rows } = await pool.query<ProviderEarningsRow>(
      `SELECT COALESCE(SUM(t.amount), 0)::text AS total_earnings,
              COALESCE((SELECT w.currency FROM wallets w WHERE w.user_id = $1 LIMIT 1), 'EGP') AS currency
       FROM transactions t
       WHERE t.user_id = $1 AND t.type IN ('payment', 'release') AND t.status = 'completed'`,
      [providerId],
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
  async getProviderOrdersCount(providerId: string): Promise<number> {
    const pool = getPool();
    const { rows } = await pool.query<ProviderOrdersRow>(
      `SELECT COUNT(*)::text AS count FROM reservations WHERE provider_id = $1`,
      [providerId],
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
}
