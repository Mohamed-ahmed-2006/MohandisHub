import type {
  EffectivePlanLimits,
  Plan,
  SubscribeToPlanResponse,
} from '@mohandishub/shared';

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletRepository } from '../wallet/wallet.repository.js';

const BILLING_CYCLE_DAYS: Record<string, number> = {
  monthly: 30,
  quarterly: 90,
  yearly: 365,
  one_time: 365,
};

export class PlansService {
  constructor(
    private readonly settingsService: SettingsService = new SettingsService(),
    private readonly walletRepo: WalletRepository = new WalletRepository(),
  ) {}
  async listActivePlans(): Promise<Plan[]> {
    const { rows } = await getPool().query(
      `SELECT * FROM plans WHERE COALESCE(is_active, true) = true ORDER BY COALESCE(sort_order, 0) ASC, COALESCE(price, 0) ASC`,
    );
    return rows.map((r: Record<string, unknown>) => this.toPlan(r));
  }

  /**
   * Resolve effective plan limits for a user (current plan from subscription or users.plan_id,
   * fallback to free plan). Used for enforcement when feature_plans_enabled is true.
   */
  async getEffectivePlanLimits(userId: string): Promise<EffectivePlanLimits> {
    const pool = getPool();
    let planId: string | null = null;
    const { rows: subRows } = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM plan_subscriptions
       WHERE user_id = $1 AND ends_at > now()
       ORDER BY ends_at DESC LIMIT 1`,
      [userId],
    );
    if (subRows.length > 0) {
      planId = subRows[0]!.plan_id;
    } else {
      const { rows: userRows } = await pool.query<{ plan_id: string | null }>(
        `SELECT plan_id FROM users WHERE id = $1`,
        [userId],
      );
      if (userRows.length > 0) planId = userRows[0]!.plan_id;
    }
    if (!planId) {
      const { rows: freeRows } = await pool.query<{ id: string }>(
        `SELECT id FROM plans WHERE slug = 'free' AND is_active = true LIMIT 1`,
      );
      if (freeRows.length > 0) planId = freeRows[0]!.id;
    }
    if (!planId) {
      return {
        maxServices: null,
        maxNeeds: null,
        maxJobs: null,
        canPriorityListing: false,
        bidsVisibleToCustomer: null,
        bidsVisibleTopN: null,
      };
    }
    const { rows: planRows } = await pool.query(
      `SELECT max_services, max_projects, plan_limits FROM plans WHERE id = $1`,
      [planId],
    );
    if (planRows.length === 0) {
      return {
        maxServices: null,
        maxNeeds: null,
        maxJobs: null,
        canPriorityListing: false,
        bidsVisibleToCustomer: null,
        bidsVisibleTopN: null,
      };
    }
    const row = planRows[0] as {
      max_services: number | null;
      max_projects: number | null;
      plan_limits: Record<string, unknown> | null;
    };
    const limits = row.plan_limits && typeof row.plan_limits === 'object' ? row.plan_limits : {};
    return {
      maxServices:
        limits.maxServices !== undefined && limits.maxServices !== null
          ? Number(limits.maxServices)
          : row.max_services,
      maxNeeds:
        limits.maxNeeds !== undefined && limits.maxNeeds !== null
          ? Number(limits.maxNeeds)
          : null,
      maxJobs:
        limits.maxJobs !== undefined && limits.maxJobs !== null
          ? Number(limits.maxJobs)
          : row.max_projects,
      canPriorityListing: Boolean(limits.canPriorityListing),
      bidsVisibleToCustomer:
        limits.bidsVisibleToCustomer && typeof limits.bidsVisibleToCustomer === 'string'
          ? (limits.bidsVisibleToCustomer as EffectivePlanLimits['bidsVisibleToCustomer'])
          : null,
      bidsVisibleTopN:
        limits.bidsVisibleTopN !== undefined && limits.bidsVisibleTopN !== null
          ? Number(limits.bidsVisibleTopN)
          : null,
    };
  }

  /**
   * Resolve the effective plan slug for session/display.
   * If user has an active plan_subscription (ends_at > now()), returns that plan's slug.
   * Otherwise returns 'free' so the UI does not show a stale paid plan after expiry.
   */
  async getEffectivePlanSlug(userId: string): Promise<string> {
    const pool = getPool();
    const { rows: subRows } = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM plan_subscriptions
       WHERE user_id = $1 AND ends_at > now()
       ORDER BY ends_at DESC LIMIT 1`,
      [userId],
    );
    if (subRows.length > 0) {
      const { rows: planRows } = await pool.query<{ slug: string }>(
        `SELECT slug FROM plans WHERE id = $1`,
        [subRows[0]!.plan_id],
      );
      if (planRows.length > 0) return planRows[0]!.slug;
    }
    return 'free';
  }

  /** Get current active subscription for user (ends_at > now(), latest first). */
  async getCurrentSubscription(userId: string): Promise<{ subscriptionEndsAt: string } | null> {
    const { rows } = await getPool().query<{ ends_at: string }>(
      `SELECT ends_at FROM plan_subscriptions
       WHERE user_id = $1 AND ends_at > now()
       ORDER BY ends_at DESC LIMIT 1`,
      [userId],
    );
    if (rows.length === 0) return null;
    return { subscriptionEndsAt: rows[0]!.ends_at };
  }

  async subscribeToPlan(userId: string, planId: string): Promise<SubscribeToPlanResponse> {
    const status = await this.settingsService.getAppStatus();
    if (status.moneyMovementsPaused || status.pausePlanSubscriptions) {
      throw new HttpError({
        statusCode: 503,
        code: 'MONEY_MOVEMENTS_PAUSED',
        message: 'Plan subscriptions are temporarily disabled.',
      });
    }

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

    const wallet = await this.walletRepo.findWalletByUserId(userId);
    if (!wallet) {
      throw new HttpError({
        statusCode: 400,
        code: 'NO_WALLET',
        message: 'No wallet found. Please deposit first.',
      });
    }
    const balance = parseFloat(wallet.balance);
    if (balance < price) {
      throw new HttpError({
        statusCode: 400,
        code: 'INSUFFICIENT_BALANCE',
        message: `Insufficient balance. Required: ${price} USD, Available: ${balance}.`,
      });
    }

    const billingCycle = (planRow.billing_cycle as string) ?? 'monthly';
    const durationDays =
      billingCycle === 'one_time'
        ? (planRow.duration_days as number) ?? 365
        : BILLING_CYCLE_DAYS[billingCycle] ?? 30;
    const startsAt = new Date();
    const endsAt = new Date(startsAt);
    endsAt.setDate(endsAt.getDate() + durationDays);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await this.walletRepo.debitWalletInTransaction(
        client,
        wallet.id,
        userId,
        price,
        `Plan subscription: ${typeof planRow.name === 'string' ? planRow.name : 'Plan'}`,
        'plan_subscription',
        planId,
      );

      await client.query(
        `INSERT INTO plan_subscriptions (user_id, plan_id, starts_at, ends_at)
         VALUES ($1, $2, $3, $4)`,
        [userId, planId, startsAt.toISOString(), endsAt.toISOString()],
      );

      await client.query(`UPDATE users SET plan_id = $1 WHERE id = $2`, [planId, userId]);

      await client.query('COMMIT');

      const updatedWallet = await this.walletRepo.findWalletByUserId(userId);
      const newBalance = updatedWallet ? parseFloat(updatedWallet.balance) : balance - price;

      return {
        plan: this.toPlan(planRow),
        walletBalance: newBalance,
        subscriptionEndsAt: endsAt.toISOString(),
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
    const rawLimits = row.plan_limits;
    const planLimits =
      rawLimits && typeof rawLimits === 'object' && !Array.isArray(rawLimits)
        ? (rawLimits as Plan['planLimits'])
        : null;
    return {
      id: typeof id === 'string' ? id : typeof id === 'number' ? String(id) : '',
      slug: typeof slug === 'string' ? slug : 'free',
      name: typeof name === 'string' ? name : 'Free',
      description: (row.description as string) ?? null,
      price: Number.isFinite(price) ? price : 0,
      currency: typeof currency === 'string' ? currency : 'USD',
      billingCycle: (row.billing_cycle as Plan['billingCycle']) ?? 'monthly',
      durationDays: (row.duration_days as number) ?? null,
      trialDays: (row.trial_days as number) ?? 0,
      maxServices: (row.max_services as number) ?? null,
      maxProjects: (row.max_projects as number) ?? null,
      features: Array.isArray(row.features) ? (row.features as string[]) : [],
      planLimits: planLimits ?? null,
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
