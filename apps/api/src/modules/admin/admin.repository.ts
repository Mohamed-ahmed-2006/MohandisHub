// ---------------------------------------------------------------------------
// Admin repository — database access layer for admin operations
// ---------------------------------------------------------------------------

import type { Pool } from 'pg';

import { getPool } from '../../db/pool.js';

import type {
  BidActivityRow,
  BookingActivityRow,
  CategoryRow,
  DashboardStatsRow,
  JobActivityRow,
  JobApplicationActivityRow,
  NeedActivityRow,
  PlanRow,
  ServiceListRow,
  TransactionListRow,
  TransactionRow,
  UserDetailRow,
  UserListRow,
  UserRow,
  UserActivityCountRow,
} from './admin.types.js';

export class AdminRepository {
  private get db(): Pool {
    return getPool();
  }

  // ── Dashboard ───────────────────────────────────────────────────────────

  async getDashboardStats(): Promise<DashboardStatsRow> {
    const { rows } = await this.db.query<DashboardStatsRow>(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL)::text AS total_users,
        (SELECT COUNT(*) FROM users WHERE is_active = true AND deleted_at IS NULL)::text AS active_users,
        (SELECT COUNT(*) FROM users WHERE primary_role = 'customer' AND deleted_at IS NULL)::text AS role_customer,
        (SELECT COUNT(*) FROM users WHERE primary_role = 'expert' AND deleted_at IS NULL)::text AS role_expert,
        (SELECT COUNT(*) FROM users WHERE primary_role = 'business' AND deleted_at IS NULL)::text AS role_business,
        (SELECT COUNT(*) FROM users WHERE is_admin = true AND deleted_at IS NULL)::text AS role_admin,
        (SELECT COUNT(*) FROM transactions)::text AS total_transactions,
        (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'deposit' AND status = 'completed')::text AS total_revenue,
        (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'completed')::text AS transaction_volume,
        (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'commission' AND status = 'completed')::text AS platform_commission_volume,
        (SELECT COUNT(*) FROM identity_documents WHERE status IN ('pending', 'under_review'))::text AS pending_verifications,
        (SELECT COUNT(*) FROM services WHERE status = 'active')::text AS active_services,
        (SELECT COUNT(*) FROM plans WHERE is_active = true)::text AS total_plans,
        COALESCE((SELECT w.balance::text FROM wallets w WHERE w.user_id = '00000000-0000-0000-0000-000000000001' LIMIT 1), '0') AS platform_wallet_balance
    `);
    return rows[0]!;
  }

  // ── Users ───────────────────────────────────────────────────────────────

  async countUsers(filters: {
    role?: string;
    isActive?: boolean;
    search?: string;
  }): Promise<number> {
    const conditions: string[] = ['u.deleted_at IS NULL'];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.role) {
      if (filters.role === 'admin') {
        conditions.push('u.is_admin = true');
      } else {
        conditions.push(`u.primary_role = $${idx++}`);
        params.push(filters.role);
      }
    }
    if (filters.isActive !== undefined) {
      conditions.push(`u.is_active = $${idx++}`);
      params.push(filters.isActive);
    }
    if (filters.search) {
      conditions.push(`(u.display_name ILIKE $${idx} OR u.email ILIKE $${idx})`);
      params.push(`%${filters.search}%`);
      idx++;
    }

    const { rows } = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users u WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return parseInt(rows[0]!.count, 10);
  }

  async listUsers(
    filters: { role?: string; isActive?: boolean; search?: string },
    page: number,
    limit: number,
  ): Promise<UserListRow[]> {
    const conditions: string[] = ['u.deleted_at IS NULL'];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.role) {
      if (filters.role === 'admin') {
        conditions.push('u.is_admin = true');
      } else {
        conditions.push(`u.primary_role = $${idx++}`);
        params.push(filters.role);
      }
    }
    if (filters.isActive !== undefined) {
      conditions.push(`u.is_active = $${idx++}`);
      params.push(filters.isActive);
    }
    if (filters.search) {
      conditions.push(`(u.display_name ILIKE $${idx} OR u.email ILIKE $${idx})`);
      params.push(`%${filters.search}%`);
      idx++;
    }

    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const { rows } = await this.db.query<UserListRow>(
      `SELECT u.*, p.slug AS plan_slug, p.name AS plan_name, u.admin_permissions
       FROM users u
       LEFT JOIN plans p ON u.plan_id = p.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY u.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    return rows;
  }

  async getUserDetail(userId: string): Promise<UserDetailRow | null> {
    const { rows } = await this.db.query<UserDetailRow>(
      `SELECT u.*, p.slug AS plan_slug, p.name AS plan_name, u.admin_permissions,
              w.balance::text AS wallet_balance, w.currency AS wallet_currency, w.is_frozen AS wallet_frozen
       FROM users u
       LEFT JOIN plans p ON u.plan_id = p.id
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async getUserById(userId: string): Promise<UserListRow | null> {
    const { rows } = await this.db.query<UserListRow>(
      `SELECT u.*, p.slug AS plan_slug, p.name AS plan_name, u.admin_permissions
       FROM users u
       LEFT JOIN plans p ON u.plan_id = p.id
       WHERE u.id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT u.* FROM users u WHERE lower(u.email) = lower($1) AND u.deleted_at IS NULL LIMIT 1`,
      [email],
    );
    return rows[0] ?? null;
  }

  async updateUser(userId: string, fields: Record<string, unknown>): Promise<UserListRow | null> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return null;

    const setClauses = entries.map(([key], i) => {
      // Allow admin_permissions array to be properly stored in JSONB
      return `${key} = $${i + 2}`;
    });
    const values = entries.map(([k, v]) => {
      if (k === 'admin_permissions' && Array.isArray(v)) {
        return JSON.stringify(v);
      }
      return v;
    });

    const { rows } = await this.db.query<UserListRow>(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $1
       RETURNING *, (SELECT slug FROM plans WHERE id = plan_id) AS plan_slug,
                    (SELECT name FROM plans WHERE id = plan_id) AS plan_name`,
      [userId, ...values],
    );
    return rows[0] ?? null;
  }

  async setEmailVerified(userId: string): Promise<void> {
    await this.db.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [userId]);
  }

  async updateUserEmail(userId: string, newEmail: string): Promise<UserListRow | null> {
    const { rows } = await this.db.query<UserListRow>(
      `UPDATE users
       SET email = $2,
           email_verified_at = NULL,
           pending_email = NULL,
           pending_email_token = NULL,
           pending_email_expires = NULL,
           updated_at = now()
       WHERE id = $1
       RETURNING *, (SELECT slug FROM plans WHERE id = plan_id) AS plan_slug,
                    (SELECT name FROM plans WHERE id = plan_id) AS plan_name`,
      [userId, newEmail],
    );
    return rows[0] ?? null;
  }

  async softDeleteUser(userId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE users SET deleted_at = now(), is_active = false WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    return (rowCount ?? 0) > 0;
  }

  async setWalletFrozen(userId: string, isFrozen: boolean): Promise<UserDetailRow | null> {
    await this.db.query(
      `INSERT INTO wallets (user_id, currency) VALUES ($1, 'USD')
       ON CONFLICT (user_id) DO UPDATE SET user_id = wallets.user_id`,
      [userId],
    );

    await this.db.query(
      `UPDATE wallets SET is_frozen = $2, updated_at = now() WHERE user_id = $1`,
      [userId, isFrozen],
    );

    return this.getUserDetail(userId);
  }

  async countNeedsByUser(userId: string): Promise<number> {
    const { rows } = await this.db.query<UserActivityCountRow>(
      `SELECT COUNT(*)::text AS count FROM needs WHERE customer_id = $1`,
      [userId],
    );
    return parseInt(rows[0]!.count, 10);
  }

  async listNeedsByUser(userId: string, page: number, limit: number): Promise<NeedActivityRow[]> {
    const offset = (page - 1) * limit;
    const { rows } = await this.db.query<NeedActivityRow>(
      `SELECT n.id, n.title, n.status, n.budget_amount::text, n.currency,
              (SELECT COUNT(*)::text FROM bids b WHERE b.need_id = n.id) AS bid_count,
              n.created_at
       FROM needs n
       WHERE n.customer_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2::int OFFSET $3::int`,
      [userId, limit, offset],
    );
    return rows;
  }

  async countBidsByUser(userId: string): Promise<number> {
    const { rows } = await this.db.query<UserActivityCountRow>(
      `SELECT COUNT(*)::text AS count FROM bids WHERE expert_id = $1`,
      [userId],
    );
    return parseInt(rows[0]!.count, 10);
  }

  async listBidsByUser(userId: string, page: number, limit: number): Promise<BidActivityRow[]> {
    const offset = (page - 1) * limit;
    const { rows } = await this.db.query<BidActivityRow>(
      `SELECT b.id, b.need_id, n.title AS need_title, b.amount::text, b.currency, b.status, b.paid_at, b.created_at
       FROM bids b
       LEFT JOIN needs n ON n.id = b.need_id
       WHERE b.expert_id = $1
       ORDER BY b.created_at DESC
       LIMIT $2::int OFFSET $3::int`,
      [userId, limit, offset],
    );
    return rows;
  }

  async countJobsByUser(userId: string): Promise<number> {
    const { rows } = await this.db.query<UserActivityCountRow>(
      `SELECT COUNT(*)::text AS count FROM jobs WHERE business_id = $1`,
      [userId],
    );
    return parseInt(rows[0]!.count, 10);
  }

  async listJobsByUser(userId: string, page: number, limit: number): Promise<JobActivityRow[]> {
    const offset = (page - 1) * limit;
    const { rows } = await this.db.query<JobActivityRow>(
      `SELECT j.id, j.title, j.status, j.created_at
       FROM jobs j
       WHERE j.business_id = $1
       ORDER BY j.created_at DESC
       LIMIT $2::int OFFSET $3::int`,
      [userId, limit, offset],
    );
    return rows;
  }

  async countJobApplicationsByUser(userId: string): Promise<number> {
    const { rows } = await this.db.query<UserActivityCountRow>(
      `SELECT COUNT(*)::text AS count FROM job_applications WHERE expert_id = $1`,
      [userId],
    );
    return parseInt(rows[0]!.count, 10);
  }

  async listJobApplicationsByUser(
    userId: string,
    page: number,
    limit: number,
  ): Promise<JobApplicationActivityRow[]> {
    const offset = (page - 1) * limit;
    const { rows } = await this.db.query<JobApplicationActivityRow>(
      `SELECT a.id, a.job_id, j.title AS job_title, a.status, a.created_at
       FROM job_applications a
       LEFT JOIN jobs j ON j.id = a.job_id
       WHERE a.expert_id = $1
       ORDER BY a.created_at DESC
       LIMIT $2::int OFFSET $3::int`,
      [userId, limit, offset],
    );
    return rows;
  }

  async countBookingsByUser(userId: string): Promise<number> {
    const { rows } = await this.db.query<UserActivityCountRow>(
      `SELECT COUNT(*)::text AS count
       FROM bookings b
       WHERE b.customer_id = $1 OR b.provider_id = $1`,
      [userId],
    );
    return parseInt(rows[0]!.count, 10);
  }

  async listBookingsByUser(
    userId: string,
    page: number,
    limit: number,
  ): Promise<BookingActivityRow[]> {
    const offset = (page - 1) * limit;
    const { rows } = await this.db.query<BookingActivityRow>(
      `SELECT b.id, b.status, b.amount::text, b.currency, s.title AS service_title,
              COALESCE(uc.display_name, uc.email) AS customer_name,
              COALESCE(up.display_name, up.email) AS provider_name,
              b.slot_start_at, b.slot_end_at, b.created_at
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN users uc ON uc.id = b.customer_id
       LEFT JOIN users up ON up.id = b.provider_id
       WHERE b.customer_id = $1 OR b.provider_id = $1
       ORDER BY b.created_at DESC
       LIMIT $2::int OFFSET $3::int`,
      [userId, limit, offset],
    );
    return rows;
  }

  // ── Plans ───────────────────────────────────────────────────────────────

  async listPlans(): Promise<PlanRow[]> {
    const { rows } = await this.db.query<PlanRow>(
      `SELECT * FROM plans ORDER BY sort_order ASC, created_at ASC`,
    );
    return rows;
  }

  async getPlan(planId: string): Promise<PlanRow | null> {
    const { rows } = await this.db.query<PlanRow>(`SELECT * FROM plans WHERE id = $1`, [planId]);
    return rows[0] ?? null;
  }

  async createPlan(fields: Record<string, unknown>): Promise<PlanRow> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    const columns = entries.map(([k]) => k);
    const placeholders = entries.map((_, i) => `$${i + 1}`);
    const values = entries.map(([k, v]) =>
      k === 'features' && Array.isArray(v) ? JSON.stringify(v) : v,
    );

    const { rows } = await this.db.query<PlanRow>(
      `INSERT INTO plans (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      values,
    );
    return rows[0]!;
  }

  async updatePlan(planId: string, fields: Record<string, unknown>): Promise<PlanRow | null> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.getPlan(planId);

    const setClauses = entries.map(([key], i) => `${key} = $${i + 2}`);
    const values = entries.map(([k, v]) =>
      k === 'features' && Array.isArray(v) ? JSON.stringify(v) : v,
    );

    const { rows } = await this.db.query<PlanRow>(
      `UPDATE plans SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [planId, ...values],
    );
    return rows[0] ?? null;
  }

  async softDeletePlan(planId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(`UPDATE plans SET is_active = false WHERE id = $1`, [
      planId,
    ]);
    return (rowCount ?? 0) > 0;
  }

  // ── Transactions ────────────────────────────────────────────────────────

  async countTransactions(filters: {
    userId?: string;
    type?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<number> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.userId) {
      conditions.push(`t.user_id = $${idx++}`);
      params.push(filters.userId);
    }
    if (filters.type) {
      conditions.push(`t.type = $${idx++}`);
      params.push(filters.type);
    }
    if (filters.status) {
      conditions.push(`t.status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.dateFrom) {
      conditions.push(`t.created_at >= $${idx++}`);
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      conditions.push(`t.created_at <= $${idx++}`);
      params.push(filters.dateTo);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM transactions t ${where}`,
      params,
    );
    return parseInt(rows[0]!.count, 10);
  }

  async listTransactions(
    filters: {
      userId?: string;
      type?: string;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    page: number,
    limit: number,
  ): Promise<TransactionListRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.userId) {
      conditions.push(`t.user_id = $${idx++}`);
      params.push(filters.userId);
    }
    if (filters.type) {
      conditions.push(`t.type = $${idx++}`);
      params.push(filters.type);
    }
    if (filters.status) {
      conditions.push(`t.status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.dateFrom) {
      conditions.push(`t.created_at >= $${idx++}`);
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      conditions.push(`t.created_at <= $${idx++}`);
      params.push(filters.dateTo);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const { rows } = await this.db.query<TransactionListRow>(
      `SELECT t.id, t.wallet_id, t.user_id, u.email AS user_email, u.display_name AS user_display_name,
              t.type, t.amount::text, t.balance_after::text, t.status, t.description,
              t.reference_type, t.created_by, t.created_at
       FROM transactions t
       JOIN users u ON u.id = t.user_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    return rows;
  }

  async getTransaction(txnId: string): Promise<TransactionRow | null> {
    const { rows } = await this.db.query<TransactionRow>(
      `SELECT * FROM transactions WHERE id = $1`,
      [txnId],
    );
    return rows[0] ?? null;
  }

  async getWalletByUserId(userId: string): Promise<{ id: string; balance: string } | null> {
    const { rows } = await this.db.query<{ id: string; balance: string }>(
      `SELECT id, balance::text FROM wallets WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async createWalletIfNotExists(userId: string): Promise<{ id: string; balance: string }> {
    const { rows } = await this.db.query<{ id: string; balance: string }>(
      `INSERT INTO wallets (user_id, currency) VALUES ($1, 'USD')
       ON CONFLICT (user_id) DO UPDATE SET user_id = wallets.user_id
       RETURNING id, balance::text`,
      [userId],
    );
    return rows[0]!;
  }

  async adjustWalletBalance(
    walletId: string,
    userId: string,
    type: string,
    amount: number,
    description: string | null,
    adminId: string,
  ): Promise<TransactionRow> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const sign = type === 'withdrawal' ? -1 : 1;
      const delta = amount * sign;

      const { rows: walletRows } = await client.query<{ balance: string }>(
        `UPDATE wallets SET balance = balance + $2 WHERE id = $1 RETURNING balance::text`,
        [walletId, delta],
      );
      const newBalance = walletRows[0]!.balance;

      const { rows: txnRows } = await client.query<TransactionRow>(
        `INSERT INTO transactions (wallet_id, user_id, type, amount, balance_after, status, description, reference_type, created_by)
         VALUES ($1, $2, $3, $4, $5, 'completed', $6, 'manual', $7) RETURNING *`,
        [walletId, userId, type, amount, newBalance, description, adminId],
      );

      await client.query('COMMIT');
      return txnRows[0]!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async reverseTransaction(txnId: string, adminId: string): Promise<TransactionRow> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const { rows: origRows } = await client.query<TransactionRow>(
        `UPDATE transactions SET status = 'reversed' WHERE id = $1 AND status = 'completed' RETURNING *`,
        [txnId],
      );
      if (origRows.length === 0) throw new Error('Transaction not found or already reversed');
      const orig = origRows[0]!;

      const sign = ['deposit', 'bonus', 'refund'].includes(orig.type) ? -1 : 1;
      const reverseAmount = parseFloat(orig.amount) * sign;

      const { rows: walletRows } = await client.query<{ balance: string }>(
        `UPDATE wallets SET balance = balance + $2 WHERE id = $1 RETURNING balance::text`,
        [orig.wallet_id, reverseAmount],
      );
      const newBalance = walletRows[0]!.balance;

      const { rows: txnRows } = await client.query<TransactionRow>(
        `INSERT INTO transactions (wallet_id, user_id, type, amount, balance_after, status, description, reference_type, reference_id, created_by)
         VALUES ($1, $2, 'adjustment', $3, $4, 'completed', $5, 'reversal', $6, $7) RETURNING *`,
        [
          orig.wallet_id,
          orig.user_id,
          Math.abs(reverseAmount),
          newBalance,
          `Reversal of transaction ${txnId}`,
          txnId,
          adminId,
        ],
      );

      await client.query('COMMIT');
      return txnRows[0]!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Services ────────────────────────────────────────────────────────────

  async countServices(filters: {
    status?: string;
    categoryId?: string;
    providerId?: string;
  }): Promise<number> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.status) {
      conditions.push(`s.status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.categoryId) {
      conditions.push(`s.category_id = $${idx++}`);
      params.push(filters.categoryId);
    }
    if (filters.providerId) {
      conditions.push(`s.provider_id = $${idx++}`);
      params.push(filters.providerId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM services s ${where}`,
      params,
    );
    return parseInt(rows[0]!.count, 10);
  }

  async listServices(
    filters: { status?: string; categoryId?: string; providerId?: string },
    page: number,
    limit: number,
  ): Promise<ServiceListRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.status) {
      conditions.push(`s.status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.categoryId) {
      conditions.push(`s.category_id = $${idx++}`);
      params.push(filters.categoryId);
    }
    if (filters.providerId) {
      conditions.push(`s.provider_id = $${idx++}`);
      params.push(filters.providerId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const { rows } = await this.db.query<ServiceListRow>(
      `SELECT s.id, s.title, s.provider_id, u.display_name AS provider_name, u.email AS provider_email,
              u.primary_role AS provider_role, c.name_en AS category_name_en, c.name_ar AS category_name_ar,
              s.price::text, s.price_type, s.status, s.is_featured, s.city, s.created_at
       FROM services s
       JOIN users u ON u.id = s.provider_id
       LEFT JOIN service_categories c ON c.id = s.category_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    return rows;
  }

  async updateService(
    serviceId: string,
    fields: Record<string, unknown>,
  ): Promise<ServiceListRow | null> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return null;

    const setClauses = entries.map(([key], i) => `${key} = $${i + 2}`);
    const values = entries.map(([, v]) => v);

    await this.db.query(`UPDATE services SET ${setClauses.join(', ')} WHERE id = $1`, [
      serviceId,
      ...values,
    ]);

    const { rows } = await this.db.query<ServiceListRow>(
      `SELECT s.id, s.title, s.provider_id, u.display_name AS provider_name, u.email AS provider_email,
              u.primary_role AS provider_role, c.name_en AS category_name_en, c.name_ar AS category_name_ar,
              s.price::text, s.price_type, s.status, s.is_featured, s.city, s.created_at
       FROM services s
       JOIN users u ON u.id = s.provider_id
       LEFT JOIN service_categories c ON c.id = s.category_id
       WHERE s.id = $1`,
      [serviceId],
    );
    return rows[0] ?? null;
  }

  // ── Categories ──────────────────────────────────────────────────────────

  async listCategories(): Promise<CategoryRow[]> {
    const { rows } = await this.db.query<CategoryRow>(
      `SELECT * FROM service_categories ORDER BY sort_order ASC, created_at ASC`,
    );
    return rows;
  }

  async getCategory(categoryId: string): Promise<CategoryRow | null> {
    const { rows } = await this.db.query<CategoryRow>(
      `SELECT * FROM service_categories WHERE id = $1`,
      [categoryId],
    );
    return rows[0] ?? null;
  }

  async createCategory(fields: Record<string, unknown>): Promise<CategoryRow> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    const columns = entries.map(([k]) => k);
    const placeholders = entries.map((_, i) => `$${i + 1}`);
    const values = entries.map(([, v]) => v);

    const { rows } = await this.db.query<CategoryRow>(
      `INSERT INTO service_categories (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      values,
    );
    return rows[0]!;
  }

  async updateCategory(
    categoryId: string,
    fields: Record<string, unknown>,
  ): Promise<CategoryRow | null> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.getCategory(categoryId);

    const setClauses = entries.map(([key], i) => `${key} = $${i + 2}`);
    const values = entries.map(([, v]) => v);

    const { rows } = await this.db.query<CategoryRow>(
      `UPDATE service_categories SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [categoryId, ...values],
    );
    return rows[0] ?? null;
  }

  async softDeleteCategory(categoryId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE service_categories SET is_active = false WHERE id = $1`,
      [categoryId],
    );
    return (rowCount ?? 0) > 0;
  }
}
