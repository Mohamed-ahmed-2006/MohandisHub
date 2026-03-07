import type { Plan } from '@mohandishub/shared';

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';

export class PlansService {
  async listActivePlans(): Promise<Plan[]> {
    const { rows } = await getPool().query(
      `SELECT * FROM plans WHERE COALESCE(is_active, true) = true ORDER BY COALESCE(sort_order, 0) ASC, COALESCE(price, 0) ASC`,
    );
    return rows.map((r: Record<string, unknown>) => this.toPlan(r));
  }

  async subscribeToPlan(
    userId: string,
    planId: string,
  ): Promise<{ plan: Plan; walletBalance: number }> {
    const pool = getPool();
    const { rows: planRows } = await pool.query(
      `SELECT * FROM plans WHERE id = $1 AND is_active = true LIMIT 1`,
      [planId],
    );
    if (planRows.length === 0) {
      throw new HttpError({
        statusCode: 404,
        code: 'PLAN_NOT_FOUND',
        message: 'Plan not found or not active.',
      });
    }
    const planRow = planRows[0] as Record<string, unknown>;
    const price = parseFloat(planRow.price as string);

    const { rows: walletRows } = await pool.query(
      `SELECT * FROM wallets WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    if (walletRows.length === 0) {
      throw new HttpError({
        statusCode: 400,
        code: 'NO_WALLET',
        message: 'No wallet found. Please deposit first.',
      });
    }
    const wallet = walletRows[0] as Record<string, unknown>;
    const balance = parseFloat(wallet.balance as string);

    if (balance < price) {
      throw new HttpError({
        statusCode: 400,
        code: 'INSUFFICIENT_BALANCE',
        message: `Insufficient balance. Required: ${price}, Available: ${balance}`,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: updatedWallet } = await client.query(
        `UPDATE wallets SET balance = balance - $1 WHERE id = $2 RETURNING *`,
        [price, wallet.id],
      );
      const newBalance = parseFloat(
        (updatedWallet[0] as Record<string, unknown>).balance as string,
      );

      await client.query(
        `INSERT INTO transactions (wallet_id, user_id, type, amount, balance_after, status, description, reference_type, reference_id)
         VALUES ($1, $2, 'debit', $3, $4, 'completed', $5, 'plan_subscription', $6)`,
        [
          wallet.id,
          userId,
          price,
          newBalance,
          `Plan subscription: ${typeof planRow.name === 'string' ? planRow.name : 'Plan'}`,
          planId,
        ],
      );

      await client.query(`UPDATE users SET plan_id = $1 WHERE id = $2`, [planId, userId]);

      await client.query('COMMIT');

      return {
        plan: this.toPlan(planRow),
        walletBalance: newBalance,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private toPlan(row: Record<string, unknown>): Plan {
    const price = Number(row.price);
    const createdAt = row.created_at;
    const updatedAt = row.updated_at;
    const id = row.id;
    const slug = row.slug;
    const name = row.name;
    const currency = row.currency;
    return {
      id: typeof id === 'string' ? id : typeof id === 'number' ? String(id) : '',
      slug: typeof slug === 'string' ? slug : 'free',
      name: typeof name === 'string' ? name : 'Free',
      description: (row.description as string) ?? null,
      price: Number.isFinite(price) ? price : 0,
      currency: typeof currency === 'string' ? currency : 'EGP',
      billingCycle: (row.billing_cycle as Plan['billingCycle']) ?? 'monthly',
      durationDays: (row.duration_days as number) ?? null,
      trialDays: (row.trial_days as number) ?? 0,
      maxServices: (row.max_services as number) ?? null,
      maxProjects: (row.max_projects as number) ?? null,
      features: Array.isArray(row.features) ? (row.features as string[]) : [],
      isActive: row.is_active !== false,
      sortOrder: (row.sort_order as number) ?? 0,
      createdAt:
        createdAt != null && typeof createdAt === 'string'
          ? createdAt
          : createdAt != null && typeof (createdAt as Date).toISOString === 'function'
            ? (createdAt as Date).toISOString()
            : new Date().toISOString(),
      updatedAt:
        updatedAt != null && typeof updatedAt === 'string'
          ? updatedAt
          : updatedAt != null && typeof (updatedAt as Date).toISOString === 'function'
            ? (updatedAt as Date).toISOString()
            : new Date().toISOString(),
    };
  }
}
