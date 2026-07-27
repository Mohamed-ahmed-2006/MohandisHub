// ---------------------------------------------------------------------------
// Admin repository — database access layer for admin operations
// ---------------------------------------------------------------------------

import type { Pool } from 'pg';

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';

import type {
  BidActivityRow,
  BookingActivityRow,
  CategoryRow,
  DashboardStatsRow,
  JobActivityRow,
  JobApplicationActivityRow,
  MoneyAuditEventRow,
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
        (SELECT COUNT(*) FROM users WHERE primary_role = 'craftsman' AND deleted_at IS NULL)::text AS role_craftsman,
        (SELECT COUNT(*) FROM users WHERE is_admin = true AND deleted_at IS NULL)::text AS role_admin,
        (SELECT COUNT(*) FROM transactions)::text AS total_transactions,
        (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'commission' AND status = 'completed')::text AS total_revenue,
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
    incompleteBusinessSignup?: boolean;
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
    if (filters.incompleteBusinessSignup) {
      conditions.push(
        `u.primary_role = 'business' AND u.email_verified_at IS NULL AND bp.onboarding_completed_at IS NULL`,
      );
    }

    const from =
      filters.incompleteBusinessSignup === true
        ? `users u LEFT JOIN business_profiles bp ON bp.user_id = u.id`
        : 'users u';

    const { rows } = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${from} WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return parseInt(rows[0]!.count, 10);
  }

  async listUsers(
    filters: {
      role?: string;
      isActive?: boolean;
      search?: string;
      incompleteBusinessSignup?: boolean;
    },
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
    if (filters.incompleteBusinessSignup) {
      conditions.push(
        `u.primary_role = 'business' AND u.email_verified_at IS NULL AND bp.onboarding_completed_at IS NULL`,
      );
    }

    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const { rows } = await this.db.query<UserListRow>(
      `SELECT u.*, p.slug AS plan_slug, p.name AS plan_name, u.admin_permissions,
              bp.onboarding_completed_at AS business_onboarding_completed_at
       FROM users u
       LEFT JOIN plans p ON u.plan_id = p.id
       LEFT JOIN business_profiles bp ON bp.user_id = u.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY u.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    return rows;
  }

  /** List user IDs for admin broadcast (e.g. send notification). Filter by role and/or isActive. */
  async listUserIds(filters: { role?: string; isActive?: boolean }): Promise<string[]> {
    const conditions: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.role) {
      if (filters.role === 'admin') {
        conditions.push('is_admin = true');
      } else {
        conditions.push(`primary_role = $${idx++}`);
        params.push(filters.role);
      }
    }
    if (filters.isActive !== undefined) {
      conditions.push(`is_active = $${idx++}`);
      params.push(filters.isActive);
    }

    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM users WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return rows.map((r) => r.id);
  }

  async getUserDetail(userId: string): Promise<UserDetailRow | null> {
    const { rows } = await this.db.query<UserDetailRow>(
      `SELECT u.*, p.slug AS plan_slug, p.name AS plan_name, u.admin_permissions,
              w.balance::text AS wallet_balance, w.currency AS wallet_currency, w.is_frozen AS wallet_frozen,
              bp.onboarding_completed_at AS business_onboarding_completed_at
       FROM users u
       LEFT JOIN plans p ON u.plan_id = p.id
       LEFT JOIN wallets w ON w.user_id = u.id
       LEFT JOIN business_profiles bp ON bp.user_id = u.id
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

  /**
   * Change a user's primary role and ensure the target role's profile row
   * exists (idempotent), atomically. Existing profile rows for other roles are
   * left in place so no data is lost if the role is switched back.
   */
  async changeUserRole(
    userId: string,
    role: 'customer' | 'expert' | 'business' | 'craftsman',
  ): Promise<UserListRow | null> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query<{ display_name: string | null }>(
        `SELECT display_name FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [userId],
      );
      if (cur.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(`UPDATE users SET primary_role = $2, updated_at = now() WHERE id = $1`, [
        userId,
        role,
      ]);

      switch (role) {
        case 'customer':
          await client.query(
            `INSERT INTO customer_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
            [userId],
          );
          break;
        case 'expert':
          await client.query(
            `INSERT INTO expert_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
            [userId],
          );
          break;
        case 'craftsman':
          await client.query(
            `INSERT INTO craftsman_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
            [userId],
          );
          break;
        case 'business':
          await client.query(
            `INSERT INTO business_profiles (user_id, company_name) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
            [userId, cur.rows[0]?.display_name?.trim() || 'Unnamed Company'],
          );
          break;
      }

      const { rows } = await client.query<UserListRow>(
        `SELECT u.*, (SELECT slug FROM plans WHERE id = u.plan_id) AS plan_slug,
                     (SELECT name FROM plans WHERE id = u.plan_id) AS plan_name
           FROM users u WHERE u.id = $1`,
        [userId],
      );
      await client.query('COMMIT');
      return rows[0] ?? null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
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
      `INSERT INTO wallets (user_id, currency) VALUES ($1, 'EGP')
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
              t.type, t.amount::text, t.balance_delta::text, t.balance_after::text, t.status, t.description,
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
      `INSERT INTO wallets (user_id, currency) VALUES ($1, 'EGP')
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

      // Lock the row and prevent debit-style adjustments from driving the
      // balance negative.
      const { rows: lockRows } = await client.query<{ balance: string }>(
        `SELECT balance::text FROM wallets WHERE id = $1 FOR UPDATE`,
        [walletId],
      );
      if (lockRows.length === 0) {
        throw new Error('Wallet not found');
      }
      const currentBalance = parseFloat(lockRows[0]!.balance);
      if (delta < 0 && currentBalance + delta < 0) {
        throw new HttpError({
          statusCode: 400,
          code: 'INSUFFICIENT_BALANCE',
          message: `Adjustment would make the wallet balance negative (current ${currentBalance}, delta ${delta}).`,
        });
      }

      const { rows: walletRows } = await client.query<{ balance: string }>(
        `UPDATE wallets SET balance = balance + $2 WHERE id = $1 RETURNING balance::text`,
        [walletId, delta],
      );
      const newBalance = walletRows[0]!.balance;

      const { rows: txnRows } = await client.query<TransactionRow>(
        `INSERT INTO transactions (wallet_id, user_id, type, amount, balance_delta, balance_after, status, description, reference_type, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, 'manual', $8) RETURNING *`,
        [walletId, userId, type, amount, delta, newBalance, description, adminId],
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

  async reverseTransaction(
    txnId: string,
    adminId: string,
    reason: string,
  ): Promise<TransactionRow> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const { rows: existingReversal } = await client.query<TransactionRow>(
        `SELECT * FROM transactions
         WHERE reference_type = 'reversal' AND reference_id = $1 AND status = 'completed'
         ORDER BY created_at DESC
         LIMIT 1`,
        [txnId],
      );
      if (existingReversal[0]) {
        await client.query('COMMIT');
        return existingReversal[0];
      }

      const { rows: origRows } = await client.query<TransactionRow>(
        `SELECT * FROM transactions WHERE id = $1 FOR UPDATE`,
        [txnId],
      );
      if (origRows.length === 0) throw new Error('Transaction not found');
      const orig = origRows[0]!;
      if (orig.status !== 'completed') throw new Error('Transaction not reversible');

      // Reverse the exact signed movement instead of inferring direction from
      // transaction type. Legacy rows without a signed delta need an audited
      // adjustment because `payment` can represent either a debit or a payout.
      if (orig.balance_delta == null) {
        throw new HttpError({
          statusCode: 409,
          code: 'LEGACY_TRANSACTION_DIRECTION_AMBIGUOUS',
          message:
            'This legacy transaction has no signed ledger movement and cannot be reversed safely. Create an audited adjustment instead.',
        });
      }
      const originalDelta = parseFloat(orig.balance_delta);
      if (!Number.isFinite(originalDelta) || originalDelta === 0) {
        throw new HttpError({
          statusCode: 409,
          code: 'TRANSACTION_HAS_NO_BALANCE_EFFECT',
          message:
            'This transaction did not change wallet balance directly and cannot be reversed. Create an audited adjustment instead.',
        });
      }
      const reverseAmount = -originalDelta;

      const { rows: walletRows } = await client.query<{ balance: string }>(
        `UPDATE wallets
         SET balance = balance + $2
         WHERE id = $1 AND balance + $2 >= 0
         RETURNING balance::text`,
        [orig.wallet_id, reverseAmount],
      );
      if (walletRows.length === 0) {
        throw new Error('Reversal would create a negative wallet balance');
      }
      const newBalance = walletRows[0]!.balance;
      await client.query(`UPDATE transactions SET status = 'reversed' WHERE id = $1`, [txnId]);

      const { rows: txnRows } = await client.query<TransactionRow>(
        `INSERT INTO transactions (wallet_id, user_id, type, amount, balance_delta, balance_after, status, description, reference_type, reference_id, created_by)
         VALUES ($1, $2, 'adjustment', $3, $4, $5, 'completed', $6, 'reversal', $7, $8) RETURNING *`,
        [
          orig.wallet_id,
          orig.user_id,
          Math.abs(reverseAmount),
          reverseAmount,
          newBalance,
          `Reversal of transaction ${txnId}: ${reason}`,
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

  async listMoneyAuditEvents(
    filters: {
      userId?: string;
      reservationId?: string;
      provider?: string;
      rail?: string;
      status?: string;
      type?: string;
      dateFrom?: string;
      dateTo?: string;
      reviewNeeded?: boolean;
    },
    page: number,
    limit: number,
  ): Promise<{ rows: MoneyAuditEventRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (filters.userId) {
      conditions.push(`user_id = $${idx++}`);
      params.push(filters.userId);
    }
    if (filters.reservationId) {
      conditions.push(`reservation_id = $${idx++}`);
      params.push(filters.reservationId);
    }
    if (filters.provider) {
      conditions.push(`rail = $${idx++}`);
      params.push(filters.provider);
    }
    if (filters.rail) {
      conditions.push(`rail = $${idx++}`);
      params.push(filters.rail);
    }
    if (filters.status) {
      conditions.push(`status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.type) {
      conditions.push(`kind = $${idx++}`);
      params.push(filters.type);
    }
    if (filters.dateFrom) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      conditions.push(`created_at <= $${idx++}`);
      params.push(filters.dateTo);
    }
    if (filters.reviewNeeded !== undefined) {
      conditions.push(`review_needed = $${idx++}`);
      params.push(filters.reviewNeeded);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const base = `
      WITH audit AS (
        SELECT t.id,
               'transaction' AS kind,
               t.user_id,
               u.email AS user_email,
               COALESCE(u.display_name, u.email) AS user_display_name,
               CASE WHEN t.reference_type = 'reservation' THEN t.reference_id ELSE NULL END AS reservation_id,
               rd.id AS dispute_id,
               t.amount::text,
               COALESCE(w.currency, 'EGP') AS currency,
               t.status,
               COALESCE(t.reference_type, 'manual') AS rail,
               COALESCE(t.description, t.type) AS label,
               t.reference_type,
               t.reference_id,
               COALESCE(
                 t.metadata->>'paymob_transaction_id',
                 t.metadata->>'paymob_order_id',
                 t.metadata->>'provider_payment_id',
                 t.metadata->>'providerWithdrawalId'
               ) AS provider_reference,
               (t.status IN ('pending', 'failed') OR t.reference_type = 'reversal') AS review_needed,
               COALESCE(t.metadata, '{}'::jsonb) AS metadata,
               t.created_at
        FROM transactions t
        LEFT JOIN users u ON u.id = t.user_id
        LEFT JOIN wallets w ON w.id = t.wallet_id
        LEFT JOIN reservation_disputes rd ON rd.reservation_id = t.reference_id::uuid
          AND t.reference_type = 'reservation'
        UNION ALL
        SELECT h.id,
               'hold' AS kind,
               h.user_id,
               u.email AS user_email,
               COALESCE(u.display_name, u.email) AS user_display_name,
               CASE WHEN h.reference_type = 'reservation' THEN h.reference_id ELSE NULL END AS reservation_id,
               rd.id AS dispute_id,
               h.amount::text,
               h.currency,
               h.status,
               h.reference_type AS rail,
               'Wallet hold' AS label,
               h.reference_type,
               h.reference_id,
               NULL AS provider_reference,
               h.status = 'held' AS review_needed,
               COALESCE(h.metadata, '{}'::jsonb) AS metadata,
               h.created_at
        FROM wallet_holds h
        LEFT JOIN users u ON u.id = h.user_id
        LEFT JOIN reservation_disputes rd ON rd.reservation_id = h.reference_id::uuid
          AND h.reference_type = 'reservation'
        UNION ALL
        SELECT d.id,
               'deposit' AS kind,
               d.user_id,
               u.email AS user_email,
               COALESCE(u.display_name, u.email) AS user_display_name,
               NULL AS reservation_id,
               NULL AS dispute_id,
               d.amount::text,
               d.currency,
               d.status,
               d.provider AS rail,
               'Wallet deposit request' AS label,
               'deposit_request' AS reference_type,
               d.id AS reference_id,
               COALESCE(d.paymob_transaction_id, d.paymob_order_id, d.provider_payment_id) AS provider_reference,
               d.status IN ('pending', 'pending_review', 'underpaid', 'failed') AS review_needed,
               COALESCE(d.provider_payload, '{}'::jsonb) AS metadata,
               d.created_at
        FROM deposit_requests d
        LEFT JOIN users u ON u.id = d.user_id
        UNION ALL
        SELECT wr.id,
               'withdrawal' AS kind,
               wr.user_id,
               u.email AS user_email,
               COALESCE(u.display_name, u.email) AS user_display_name,
               NULL AS reservation_id,
               NULL AS dispute_id,
               COALESCE(wr.source_amount_egp, wr.amount)::text AS amount,
               COALESCE(wr.currency, 'EGP') AS currency,
               wr.status,
               wr.provider AS rail,
               'Wallet withdrawal request' AS label,
               'withdrawal_request' AS reference_type,
               wr.id AS reference_id,
               COALESCE(wr.paymob_payout_reference, wr.provider_withdrawal_id) AS provider_reference,
               wr.status IN ('pending_verification', 'processing', 'awaiting_transfer', 'failed', 'blocked') AS review_needed,
               COALESCE(wr.provider_payload, '{}'::jsonb) AS metadata,
               wr.created_at
        FROM withdrawal_requests wr
        LEFT JOIN users u ON u.id = wr.user_id
        UNION ALL
        SELECT f.id,
               'reservation_failure' AS kind,
               f.actor_id AS user_id,
               u.email AS user_email,
               COALESCE(u.display_name, u.email) AS user_display_name,
               f.reservation_id,
               rd.id AS dispute_id,
               '0' AS amount,
               'EGP' AS currency,
               CASE WHEN f.resolved_at IS NULL THEN 'open' ELSE 'resolved' END AS status,
               'worker' AS rail,
               f.error_message AS label,
               'reservation_action_failure' AS reference_type,
               f.id AS reference_id,
               NULL AS provider_reference,
               f.resolved_at IS NULL AS review_needed,
               COALESCE(f.metadata, '{}'::jsonb) AS metadata,
               f.created_at
        FROM reservation_action_failures f
        LEFT JOIN users u ON u.id = f.actor_id
        LEFT JOIN reservation_disputes rd ON rd.reservation_id = f.reservation_id
      )
    `;
    const count = await this.db.query<{ count: string }>(
      `${base} SELECT COUNT(*)::text AS count FROM audit ${where}`,
      params,
    );
    const total = parseInt(count.rows[0]?.count ?? '0', 10);
    params.push(limit, (page - 1) * limit);
    const rows = await this.db.query<MoneyAuditEventRow>(
      `${base}
       SELECT id, kind, user_id, user_email, user_display_name, reservation_id, dispute_id,
              amount, currency, status, rail, label, reference_type, reference_id,
              provider_reference, review_needed, metadata, created_at::text
       FROM audit
       ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    return { rows: rows.rows, total };
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
              s.price::text, s.currency, s.price_type, s.status, s.is_featured, s.city, s.created_at
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
              s.price::text, s.currency, s.price_type, s.status, s.is_featured, s.city, s.created_at
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

  /** Factory reset: delete all users except platform and current admin. Returns number of users deleted. */
  async factoryReset(adminId: string): Promise<number> {
    const PLATFORM_USER_ID = '00000000-0000-0000-0000-000000000001';
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const { rows: userRows } = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE id != $1 AND id != $2`,
        [PLATFORM_USER_ID, adminId],
      );
      const toDelete = userRows.map((r) => r.id);
      if (toDelete.length === 0) {
        await client.query('COMMIT');
        return 0;
      }

      // Delete in FK-safe order (tables that reference users without ON DELETE CASCADE)
      await client.query(
        `DELETE FROM transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id = ANY($1::uuid[]))`,
        [toDelete],
      );
      await client.query(`DELETE FROM messages WHERE sender_id = ANY($1::uuid[])`, [toDelete]);
      await client.query(
        `DELETE FROM conversations WHERE participant_a = ANY($1::uuid[]) OR participant_b = ANY($1::uuid[])`,
        [toDelete],
      );
      await client.query(
        `DELETE FROM reviews WHERE reviewer_id = ANY($1::uuid[]) OR target_user_id = ANY($1::uuid[])`,
        [toDelete],
      );
      await client.query(
        `DELETE FROM reservations WHERE customer_id = ANY($1::uuid[]) OR provider_id = ANY($1::uuid[])`,
        [toDelete],
      );
      await client.query(
        `DELETE FROM bookings WHERE customer_id = ANY($1::uuid[]) OR provider_id = ANY($1::uuid[])`,
        [toDelete],
      );
      await client.query(
        `UPDATE needs SET awarded_bid_id = NULL WHERE awarded_bid_id IN (SELECT id FROM bids WHERE expert_id = ANY($1::uuid[]))`,
        [toDelete],
      );
      await client.query(`DELETE FROM bids WHERE expert_id = ANY($1::uuid[])`, [toDelete]);
      await client.query(`DELETE FROM needs WHERE customer_id = ANY($1::uuid[])`, [toDelete]);
      await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [toDelete]);

      await client.query('COMMIT');
      return toDelete.length;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
