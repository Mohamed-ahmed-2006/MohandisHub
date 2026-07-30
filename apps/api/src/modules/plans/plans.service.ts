import { randomUUID } from 'node:crypto';

import type {
  EffectivePlanLimits,
  Plan,
  PlanSubscriberRole,
  PlanUsageQuotaLine,
  PlanUsageSummary,
  SubscribeToPlanResponse,
} from '@mohandishub/shared';
import {
  normalizePlanAllowedRoles,
  normalizeUsageQuotasFromPlanLimits,
  PLAN_SUBSCRIBER_ROLES,
  USAGE_QUOTA_KEYS_FOR_ROLE,
} from '@mohandishub/shared';

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { MhcService } from '../mhc/mhc.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletRepository } from '../wallet/wallet.repository.js';

import { UsageQuotaService } from './usage-quota.service.js';

const BILLING_CYCLE_DAYS: Record<string, number> = {
  monthly: 30,
  quarterly: 90,
  yearly: 365,
  one_time: 365,
};

/**
 * Plans are priced per plan, through the generic scoped-price table:
 *   action_key = 'subscription_upgrade', scope_type = 'plan', scope_id = plan.id
 *
 * One shared price for every plan was rejected, and so was one action key per
 * plan. This keeps a single action key and moves the variation into the scope.
 */
const PLAN_ACTION_KEY = 'subscription_upgrade';
const PLAN_REFERENCE_TYPE = 'plan_subscription';

const SUBSCRIBER_ROLE_SET = new Set<string>(PLAN_SUBSCRIBER_ROLES);

export class PlansService {
  constructor(
    private readonly settingsService: SettingsService = new SettingsService(),
    /**
     * Retained for the legacy EGP code paths only. The purchase path no longer
     * reads, locks or debits a money wallet — plans are bought with MHC.
     */
    private readonly walletRepo: WalletRepository = new WalletRepository(),
    private readonly usageQuotaService: UsageQuotaService = new UsageQuotaService(),
    private readonly mhc: MhcService = new MhcService(),
  ) {}

  /** The subscription a previous attempt with this idempotency key created. */
  private async findSubscriptionByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<{ id: string; ends_at: string; mhc_price_paid: string | null } | null> {
    const { rows } = await getPool().query<{
      id: string;
      ends_at: string;
      mhc_price_paid: string | null;
    }>(
      `SELECT id, ends_at::text, mhc_price_paid::text
       FROM plan_subscriptions
       WHERE user_id = $1 AND client_idempotency_key = $2
       LIMIT 1`,
      [userId, idempotencyKey],
    );
    return rows[0] ?? null;
  }
  /**
   * Lists active plans visible to the given primary role. Admins see the full catalog (for support/testing).
   */
  async listActivePlansForRole(primaryRole: string): Promise<Plan[]> {
    const status = await this.settingsService.getAppStatus();
    if (!status.featurePlansEnabled) {
      throw new HttpError({
        statusCode: 503,
        code: 'FEATURE_DISABLED',
        message: 'Plans are currently disabled.',
      });
    }
    const { rows } = await getPool().query(
      `SELECT * FROM plans
       WHERE COALESCE(is_active, true) = true AND COALESCE(is_visible, true) = true
       ORDER BY COALESCE(sort_order, 0) ASC, COALESCE(price, 0) ASC`,
    );
    // One query for every plan's MHC price, so a catalogue of N plans does not
    // become N+1 round trips.
    const scopedPrices = await this.mhc.listScopedPrices(PLAN_ACTION_KEY, 'plan');
    const plans = rows.map((r: Record<string, unknown>) =>
      this.toPlan(r, scopedPrices.get(String(r.id)) ?? null),
    );
    if (primaryRole === 'admin') return plans;
    if (!SUBSCRIBER_ROLE_SET.has(primaryRole)) return [];
    const role = primaryRole as PlanSubscriberRole;
    return plans.filter((p) => p.allowedRoles.includes(role));
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
        maxBidsPerNeed: null,
        maxActiveBids: null,
        maxBusinessServices: null,
        maxTeamSlots: null,
        canBusinessFeatured: false,
        usageQuotas: {},
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
        maxBidsPerNeed: null,
        maxActiveBids: null,
        maxBusinessServices: null,
        maxTeamSlots: null,
        canBusinessFeatured: false,
        usageQuotas: {},
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
        limits.maxNeeds !== undefined && limits.maxNeeds !== null ? Number(limits.maxNeeds) : null,
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
      maxBidsPerNeed:
        limits.maxBidsPerNeed !== undefined && limits.maxBidsPerNeed !== null
          ? Number(limits.maxBidsPerNeed)
          : null,
      maxActiveBids:
        limits.maxActiveBids !== undefined && limits.maxActiveBids !== null
          ? Number(limits.maxActiveBids)
          : null,
      maxBusinessServices:
        limits.maxBusinessServices !== undefined && limits.maxBusinessServices !== null
          ? Number(limits.maxBusinessServices)
          : null,
      maxTeamSlots:
        limits.maxTeamSlots !== undefined && limits.maxTeamSlots !== null
          ? Number(limits.maxTeamSlots)
          : null,
      canBusinessFeatured: Boolean(limits.canBusinessFeatured),
      usageQuotas: normalizeUsageQuotasFromPlanLimits(limits),
    };
  }

  private async buildUsageQuotaLines(
    userId: string,
    role: 'customer' | 'expert' | 'craftsman' | 'business',
    limits: EffectivePlanLimits,
  ): Promise<PlanUsageQuotaLine[]> {
    const keys = USAGE_QUOTA_KEYS_FOR_ROLE[role];
    const out: PlanUsageQuotaLine[] = [];
    for (const featureKey of keys) {
      const def = limits.usageQuotas[featureKey];
      if (!def) continue;
      const { start, end } = await this.usageQuotaService.resolvePeriodBounds(userId, def.period);
      const used = await this.usageQuotaService.getCountForWindow(userId, featureKey, start);
      out.push({
        featureKey,
        period: def.period,
        maxPerPeriod: def.maxPerPeriod,
        used,
        remaining: Math.max(0, def.maxPerPeriod - used),
        periodEndsAt: end.toISOString(),
      });
    }
    return out;
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

  /**
   * Subscribes using `users.primary_role` for eligibility. If an admin changes a user's role
   * while they hold a paid plan, limits follow the new role on next action; subscription row is unchanged until expiry.
   *
   * ---------------------------------------------------------------------------
   * LAUNCH CONSTRAINT LC-02 — no plan is purchasable at launch.
   * ---------------------------------------------------------------------------
   * Everything below the pause guard is the LEGACY EGP implementation. It reads,
   * locks and debits the `money` wallet that migration 20260728160000 froze, so
   * it cannot succeed for a priced plan anyway — and it must not be reached even
   * for a free one, because reaching it would lock an EGP wallet row.
   *
   * It is deliberately NOT deleted. The plan catalogue is multi-tier by design
   * (each plan carries its own price, currency, billing_cycle and duration_days),
   * while MHC pricing is one price per action key. Charging `subscription_upgrade`
   * would either flatten every paid tier onto one identical price or require
   * per-plan action keys — a new monetisation model, not a migration of this one.
   * Neither was approved, so neither was built, and this code stays intact so
   * whichever model is chosen starts from working code and an unbroken history.
   *
   * The Free plan needs no subscribe call: it is the default `users.plan_id` and
   * `getEffectivePlanLimits` / `getEffectivePlanSlug` already fall back to it, so
   * pausing this endpoint does not take anything away from a free user.
   *
   * See docs/release/LAUNCH_CONSTRAINTS.md#lc-02.
   */
  async subscribeToPlan(
    userId: string,
    planId: string,
    idempotencyKey?: string | null,
  ): Promise<SubscribeToPlanResponse> {
    const status = await this.settingsService.getAppStatus();
    if (!status.featurePlansEnabled) {
      throw new HttpError({
        statusCode: 503,
        code: 'FEATURE_DISABLED',
        message: 'Plans are currently disabled.',
      });
    }

    // FIRST, and before any database work: no wallet is read, no wallet row is
    // locked, no `plan_subscriptions` row is written while subscriptions are
    // paused. A distinct code from MONEY_MOVEMENTS_PAUSED, because "we have not
    // launched paid plans" and "money movements are temporarily halted" are
    // different situations with different answers for the caller.
    if (status.pausePlanSubscriptions) {
      throw new HttpError({
        statusCode: 503,
        code: 'PLAN_SUBSCRIPTIONS_PAUSED',
        message:
          'Paid plans are not available yet. Your current plan and its benefits are unchanged.',
      });
    }
    if (status.moneyMovementsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'MONEY_MOVEMENTS_PAUSED',
        message: 'Plan subscriptions are temporarily disabled.',
      });
    }

    const pool = getPool();
    const { rows: userRoleRows } = await pool.query<{ primary_role: string }>(
      `SELECT primary_role FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const primaryRole = userRoleRows[0]?.primary_role ?? 'customer';

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
    const allowed = normalizePlanAllowedRoles(planRow.allowed_roles);
    if (primaryRole !== 'admin' && !SUBSCRIBER_ROLE_SET.has(primaryRole)) {
      throw new HttpError({
        statusCode: 403,
        code: 'PLAN_ROLE_NOT_ALLOWED',
        message: 'Your account role cannot subscribe to plans.',
      });
    }
    if (primaryRole !== 'admin' && !allowed.includes(primaryRole as PlanSubscriberRole)) {
      throw new HttpError({
        statusCode: 403,
        code: 'PLAN_NOT_ALLOWED_FOR_ROLE',
        message: 'This plan is not available for your role.',
      });
    }

    // The plan must be deliberately on sale. Both checks happen BEFORE any
    // wallet or transaction work, so a plan that is not for sale never touches
    // the money layer at all.
    if (planRow.is_purchasable !== true) {
      throw new HttpError({
        statusCode: 409,
        code: 'PLAN_NOT_PURCHASABLE',
        message: 'This plan is not available for purchase yet.',
      });
    }

    const isFreePlan = planRow.slug === 'free';
    // Price resolution for DISPLAY and for the free-plan decision only. The
    // charge itself re-resolves the price inside the transaction from the same
    // scope, so what is read here can never become what is charged.
    const scopedPrice = isFreePlan
      ? 0
      : await this.mhc.getScopedPrice(PLAN_ACTION_KEY, 'plan', planId);
    if (scopedPrice === null) {
      // Fail CLOSED: a paid plan with no active scoped price is a configuration
      // gap, never a reason to charge a global default or to give it away.
      throw new HttpError({
        statusCode: 503,
        code: 'PLAN_MHC_PRICE_MISSING',
        message: 'This plan has no credit price configured yet.',
      });
    }

    const billingCycle = (planRow.billing_cycle as string) ?? 'monthly';
    const durationDays =
      billingCycle === 'one_time'
        ? ((planRow.duration_days as number) ?? 365)
        : (BILLING_CYCLE_DAYS[billingCycle] ?? 30);
    const startsAt = new Date();
    const endsAt = new Date(startsAt);
    endsAt.setDate(endsAt.getDate() + durationDays);
    // Preallocated so the charge can reference the subscription before it commits.
    const subscriptionId = randomUUID();

    if (idempotencyKey) {
      // Fast path: a completed retry never re-enters the transaction.
      const existing = await this.findSubscriptionByIdempotencyKey(userId, idempotencyKey);
      if (existing) {
        return {
          plan: this.toPlan(planRow),
          mhcCharged: parseFloat(existing.mhc_price_paid ?? '0'),
          mhcBalance: await this.mhc.getBalanceFor(userId),
          subscriptionEndsAt: existing.ends_at,
        };
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialises this user's purchases. Two concurrent buys queue here, so the
      // active-subscription check below cannot be made against a stale read.
      await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);

      const { rows: activeSubscriptionRows } = await client.query<{
        id: string;
        plan_id: string;
        ends_at: string;
        mhc_price_paid: string | null;
      }>(
        `SELECT id, plan_id, ends_at::text, mhc_price_paid::text
         FROM plan_subscriptions
         WHERE user_id = $1 AND ends_at > now()
         ORDER BY ends_at DESC
         FOR UPDATE`,
        [userId],
      );
      const activeSubscription = activeSubscriptionRows[0] ?? null;

      // Already on this exact plan: report it, charge nothing.
      if (activeSubscription?.plan_id === planId) {
        await client.query('COMMIT');
        return {
          plan: this.toPlan(planRow),
          mhcCharged: 0,
          mhcBalance: await this.mhc.getBalanceFor(userId),
          subscriptionEndsAt: activeSubscription.ends_at,
        };
      }

      // A different paid plan is still running. No prorating, no refunds and no
      // mid-cycle switching in this task, so the honest answer is to refuse and
      // say when they may switch — NOT to silently truncate a subscription the
      // provider already paid for.
      if (activeSubscription && !isFreePlan) {
        throw new HttpError({
          statusCode: 409,
          code: 'PLAN_ALREADY_ACTIVE',
          message:
            'You already have an active plan. You can choose a different plan once it expires.',
          details: { activeUntil: activeSubscription.ends_at },
        });
      }

      // The free plan is the fallback entitlement and needs no purchase. It must
      // never be able to cancel a paid subscription that is still running.
      if (isFreePlan) {
        if (activeSubscription) {
          throw new HttpError({
            statusCode: 409,
            code: 'PLAN_ALREADY_ACTIVE',
            message: 'Your paid plan is still active. Free applies automatically once it expires.',
            details: { activeUntil: activeSubscription.ends_at },
          });
        }
        await client.query('COMMIT');
        return {
          plan: this.toPlan(planRow),
          mhcCharged: 0,
          mhcBalance: await this.mhc.getBalanceFor(userId),
          subscriptionEndsAt: null,
        };
      }

      // Charge and subscription in ONE transaction: a failed charge leaves no
      // subscription, a failed subscription leaves no charge. The price comes
      // from the plan's scope, resolved inside the primitive — never passed in.
      const charge = await this.mhc.chargeAction({
        client,
        userId,
        actionKey: PLAN_ACTION_KEY,
        referenceType: PLAN_REFERENCE_TYPE,
        referenceId: subscriptionId,
        priceScope: { scopeType: 'plan', scopeId: planId },
        idempotencyKey: `plan_subscription:${subscriptionId}`,
        description: `Plan subscription: ${typeof planRow.name === 'string' ? planRow.name : 'Plan'}`,
        metadata: { plan_id: planId, duration_days: durationDays },
      });

      // Snapshot what was charged, so a later admin price change cannot rewrite
      // the history of this purchase.
      await client.query(
        `INSERT INTO plan_subscriptions (
           id, user_id, plan_id, starts_at, ends_at,
           mhc_price_paid, duration_days_used, action_charge_id, client_idempotency_key
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          subscriptionId,
          userId,
          planId,
          startsAt.toISOString(),
          endsAt.toISOString(),
          charge.mhcCharged,
          durationDays,
          charge.chargeId,
          idempotencyKey ?? null,
        ],
      );

      await client.query(`UPDATE users SET plan_id = $1 WHERE id = $2`, [planId, userId]);

      await client.query('COMMIT');

      return {
        plan: this.toPlan(planRow),
        mhcCharged: charge.mhcCharged,
        mhcBalance: charge.balanceAfter,
        subscriptionEndsAt: endsAt.toISOString(),
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      // Lost the domain idempotency race: a concurrent identical request
      // committed first. Report its subscription rather than an error.
      if (
        idempotencyKey &&
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: unknown }).code === '23505'
      ) {
        const winner = await this.findSubscriptionByIdempotencyKey(userId, idempotencyKey);
        if (winner) {
          return {
            plan: this.toPlan(planRow),
            mhcCharged: parseFloat(winner.mhc_price_paid ?? '0'),
            mhcBalance: await this.mhc.getBalanceFor(userId),
            subscriptionEndsAt: winner.ends_at,
          };
        }
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Usage vs plan caps for the current user. Limits are **concurrent** (active open slots), not monthly quotas:
   * e.g. completing or closing a need frees a slot for customers.
   */
  async getMyUsage(userId: string): Promise<PlanUsageSummary> {
    const appStatus = await this.settingsService.getAppStatus();
    const empty: PlanUsageSummary = {
      plansFeatureEnabled: appStatus.featurePlansEnabled,
      resetPolicy: 'concurrent_slots',
      usageQuotas: [],
      customer: null,
      individualProvider: null,
      business: null,
    };
    if (!appStatus.featurePlansEnabled) return empty;

    const pool = getPool();
    const { rows: roleRows } = await pool.query<{ primary_role: string }>(
      `SELECT primary_role FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const role = roleRows[0]?.primary_role ?? 'customer';
    const limits = await this.getEffectivePlanLimits(userId);

    const quotaRole =
      role === 'customer' || role === 'expert' || role === 'craftsman' || role === 'business'
        ? role
        : null;
    const quotaLines = quotaRole ? await this.buildUsageQuotaLines(userId, quotaRole, limits) : [];

    if (role === 'customer') {
      const { rows } = await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM needs
         WHERE customer_id = $1 AND status IN ('open', 'awarded', 'in_progress')`,
        [userId],
      );
      const active = rows[0]?.c ? parseInt(rows[0].c, 10) : 0;
      const max = limits.maxNeeds;
      return {
        ...empty,
        usageQuotas: quotaLines,
        customer: {
          maxNeeds: max,
          activeNeedsCount: active,
          remainingNeeds: max == null ? null : Math.max(0, max - active),
        },
      };
    }

    if (role === 'expert' || role === 'craftsman') {
      const { rows: sRows } = await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM services WHERE provider_id = $1`,
        [userId],
      );
      const svc = sRows[0]?.c ? parseInt(sRows[0].c, 10) : 0;
      const maxS = limits.maxServices;
      const { rows: bRows } = await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM bids WHERE expert_id = $1 AND status = 'pending'`,
        [userId],
      );
      const pending = bRows[0]?.c ? parseInt(bRows[0].c, 10) : 0;
      const maxB = limits.maxActiveBids;
      return {
        ...empty,
        usageQuotas: quotaLines,
        individualProvider: {
          maxServices: maxS,
          servicesCount: svc,
          remainingServices: maxS == null ? null : Math.max(0, maxS - svc),
          maxActiveBids: maxB,
          pendingBidsCount: pending,
          remainingActiveBids: maxB == null ? null : Math.max(0, maxB - pending),
        },
      };
    }

    if (role === 'business') {
      const cap = limits.maxBusinessServices ?? limits.maxServices;
      const { rows: sRows } = await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM services WHERE provider_id = $1`,
        [userId],
      );
      const svc = sRows[0]?.c ? parseInt(sRows[0].c, 10) : 0;
      const { rows: jRows } = await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM jobs WHERE business_id = $1`,
        [userId],
      );
      const jobs = jRows[0]?.c ? parseInt(jRows[0].c, 10) : 0;
      const maxJ = limits.maxJobs;
      return {
        ...empty,
        usageQuotas: quotaLines,
        business: {
          maxJobs: maxJ,
          jobsCount: jobs,
          remainingJobs: maxJ == null ? null : Math.max(0, maxJ - jobs),
          maxBusinessServices: cap,
          servicesCount: svc,
          remainingBusinessServices: cap == null ? null : Math.max(0, cap - svc),
        },
      };
    }

    return { ...empty, usageQuotas: quotaLines };
  }

  private toPlan(row: Record<string, unknown>, mhcPrice: number | null = null): Plan {
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
      currency: typeof currency === 'string' ? currency : 'EGP',
      billingCycle: (row.billing_cycle as Plan['billingCycle']) ?? 'monthly',
      durationDays: (row.duration_days as number) ?? null,
      trialDays: (row.trial_days as number) ?? 0,
      // Both default to fail-closed shapes when a row predates the columns.
      isPurchasable: row.is_purchasable === true,
      isVisible: row.is_visible !== false,
      mhcPrice,
      maxServices: (row.max_services as number) ?? null,
      maxProjects: (row.max_projects as number) ?? null,
      features: Array.isArray(row.features) ? (row.features as string[]) : [],
      allowedRoles: normalizePlanAllowedRoles(row.allowed_roles),
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
