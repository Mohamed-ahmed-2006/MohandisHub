import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlansService } from '../modules/plans/plans.service.js';

import {
  balanceOf,
  countRows,
  createScratchDatabase,
  pgIntegrationEnabled,
  seedProvider,
  type ScratchDatabase,
} from './support/pg-scratch.js';

// ---------------------------------------------------------------------------
// Per-plan MHC pricing against a REAL PostgreSQL server.
// ---------------------------------------------------------------------------
// Every paid plan carries its own admin-configured MHC price, resolved from
// `mhc_action_price_scopes` INSIDE the charging transaction. The properties that
// matter are properties of rows — two plans charging two different amounts, an
// admin price change not rewriting an existing subscription, ten concurrent
// purchases producing one subscription — so they are asserted against a
// disposable database built by replaying every migration.
//
// Opt-in:  RUN_PG_INTEGRATION=1 npm run test -w @mohandishub/api
// ---------------------------------------------------------------------------

let scratch: ScratchDatabase;
let pool: Pool;

vi.mock('../db/pool.js', () => ({
  getPool: () => pool,
  hasDatabaseConfig: () => true,
}));

const PLAN_ACTION_KEY = 'subscription_upgrade';

const service = (): PlansService =>
  new PlansService({
    getAppStatus: () =>
      Promise.resolve({
        featurePlansEnabled: true,
        moneyMovementsPaused: false,
        pausePlanSubscriptions: false,
      }),
  } as never);

/** Create a plan row directly; the admin surface is covered by its own tests. */
const seedPlan = async (params: {
  slug: string;
  name?: string;
  purchasable?: boolean;
  visible?: boolean;
  billingCycle?: string;
}): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO plans (slug, name, price, currency, billing_cycle, allowed_roles,
                        is_active, is_purchasable, is_visible)
     VALUES ($1, $2, 0, 'EGP', $3, ARRAY['customer','expert','business','craftsman']::text[],
             true, $4, $5)
     RETURNING id`,
    [
      params.slug,
      params.name ?? params.slug,
      params.billingCycle ?? 'monthly',
      params.purchasable ?? true,
      params.visible ?? true,
    ],
  );
  return rows[0]!.id;
};

/** Set a plan's MHC price the way the admin surface does. */
const setPlanPrice = async (planId: string, mhcPrice: number | null): Promise<void> => {
  await pool.query(
    `UPDATE mhc_action_price_scopes SET is_active = false
     WHERE action_key = $1 AND scope_type = 'plan' AND scope_id = $2 AND is_active = true`,
    [PLAN_ACTION_KEY, planId],
  );
  if (mhcPrice === null) return;
  await pool.query(
    `INSERT INTO mhc_action_price_scopes (action_key, scope_type, scope_id, mhc_price, is_active)
     VALUES ($1, 'plan', $2, $3, true)`,
    [PLAN_ACTION_KEY, planId, mhcPrice],
  );
};

const subscriptionCount = (userId: string): Promise<number> =>
  countRows(pool, `SELECT count(*)::text c FROM plan_subscriptions WHERE user_id = $1`, [userId]);

const chargeCount = (userId: string): Promise<number> =>
  countRows(pool, `SELECT count(*)::text c FROM mhc_action_charges WHERE user_id = $1`, [userId]);

const ledgerCount = (userId: string): Promise<number> =>
  countRows(pool, `SELECT count(*)::text c FROM transactions WHERE user_id = $1`, [userId]);

beforeAll(async () => {
  if (!pgIntegrationEnabled()) return;
  scratch = await createScratchDatabase('plans');
  pool = scratch.pool;
}, 1_800_000);

afterAll(async () => {
  // Always drop, including after a failure.
  if (scratch) await scratch.drop();
}, 300_000);

beforeEach(async () => {
  if (!pgIntegrationEnabled()) return;
  // A clean slate per test, inside the scratch database only.
  //
  // Order matters: a completed purchase points `users.plan_id` at the plan it
  // bought, and `users_plan_id_fkey` would block deleting that plan. Every user
  // is returned to the free plan first. Subscriptions go before their charges
  // because `plan_subscriptions.action_charge_id` is ON DELETE RESTRICT.
  await pool.query(`UPDATE users SET plan_id = (SELECT id FROM plans WHERE slug = 'free' LIMIT 1)`);
  await pool.query(`DELETE FROM plan_subscriptions`);
  await pool.query(`DELETE FROM mhc_action_price_scopes`);
  await pool.query(`DELETE FROM plans WHERE slug <> 'free'`);
});

describe.skipIf(!pgIntegrationEnabled())('per-plan MHC pricing', () => {
  it('charges each plan its own admin-configured price', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const cheap = await seedPlan({ slug: 'starter' });
    const rich = await seedPlan({ slug: 'elite' });
    await setPlanPrice(cheap, 25);
    await setPlanPrice(rich, 120);

    const first = await service().subscribeToPlan(userId, cheap);
    expect(first.mhcCharged).toBe(25);
    expect(await balanceOf(pool, userId)).toBe(475);

    // Expire it so a second, differently-priced plan may be bought.
    await pool.query(`UPDATE plan_subscriptions SET ends_at = now() - interval '1 day'`);

    const second = await service().subscribeToPlan(userId, rich);
    expect(second.mhcCharged).toBe(120);
    expect(await balanceOf(pool, userId)).toBe(355);
    expect(await chargeCount(userId)).toBe(2);
  }, 120_000);

  it('writes one subscription, one ledger row and one charge row', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const planId = await seedPlan({ slug: 'solo' });
    await setPlanPrice(planId, 40);

    const result = await service().subscribeToPlan(userId, planId);

    expect(await subscriptionCount(userId)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    expect(await ledgerCount(userId)).toBe(1);
    expect(await balanceOf(pool, userId)).toBe(60);

    const { rows } = await pool.query<{
      mhc_price_paid: string;
      duration_days_used: number;
      action_charge_id: string;
      plan_id: string;
    }>(
      `SELECT mhc_price_paid::text, duration_days_used, action_charge_id, plan_id
       FROM plan_subscriptions WHERE user_id = $1`,
      [userId],
    );
    expect(rows[0]).toMatchObject({
      mhc_price_paid: '40.00',
      duration_days_used: 30,
      plan_id: planId,
    });
    expect(rows[0]!.action_charge_id).not.toBeNull();

    const { rows: chargeRows } = await pool.query<{ reference_type: string; action_key: string }>(
      `SELECT reference_type, action_key FROM mhc_action_charges WHERE user_id = $1`,
      [userId],
    );
    expect(chargeRows[0]).toMatchObject({
      reference_type: 'plan_subscription',
      action_key: PLAN_ACTION_KEY,
    });
    expect(result.mhcBalance).toBe(60);
  });

  it('applies an admin price change to future purchases only', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const planId = await seedPlan({ slug: 'shifting' });
    await setPlanPrice(planId, 30);

    await service().subscribeToPlan(userId, planId);
    const before = await pool.query<{ mhc_price_paid: string }>(
      `SELECT mhc_price_paid::text FROM plan_subscriptions WHERE user_id = $1`,
      [userId],
    );
    expect(before.rows[0]!.mhc_price_paid).toBe('30.00');

    // Admin raises the price. The existing subscription must not be rewritten.
    await setPlanPrice(planId, 90);
    const after = await pool.query<{ mhc_price_paid: string }>(
      `SELECT mhc_price_paid::text FROM plan_subscriptions WHERE user_id = $1`,
      [userId],
    );
    expect(after.rows[0]!.mhc_price_paid).toBe('30.00');

    // The next purchase pays the new price.
    await pool.query(`UPDATE plan_subscriptions SET ends_at = now() - interval '1 day'`);
    const next = await service().subscribeToPlan(userId, planId);
    expect(next.mhcCharged).toBe(90);
  }, 120_000);

  it('enforces one active scoped price per plan at the database', async () => {
    const planId = await seedPlan({ slug: 'dupe' });
    await setPlanPrice(planId, 10);

    await expect(
      pool.query(
        `INSERT INTO mhc_action_price_scopes (action_key, scope_type, scope_id, mhc_price, is_active)
         VALUES ($1, 'plan', $2, 99, true)`,
        [PLAN_ACTION_KEY, planId],
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'uq_mhc_action_price_scope_active' });
  });

  it('rejects a negative scoped price at the database', async () => {
    const planId = await seedPlan({ slug: 'negative' });
    await expect(
      pool.query(
        `INSERT INTO mhc_action_price_scopes (action_key, scope_type, scope_id, mhc_price, is_active)
         VALUES ($1, 'plan', $2, -5, true)`,
        [PLAN_ACTION_KEY, planId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe.skipIf(!pgIntegrationEnabled())('purchase refusals leave no trace', () => {
  it('returns 402 and creates nothing when MHC is short', async () => {
    const { userId } = await seedProvider(pool, { mhc: 10 });
    const planId = await seedPlan({ slug: 'pricey' });
    await setPlanPrice(planId, 80);

    await expect(service().subscribeToPlan(userId, planId)).rejects.toMatchObject({
      statusCode: 402,
      code: 'MHC_INSUFFICIENT_CREDITS',
    });

    expect(await balanceOf(pool, userId)).toBe(10);
    expect(await subscriptionCount(userId)).toBe(0);
    expect(await chargeCount(userId)).toBe(0);
    expect(await ledgerCount(userId)).toBe(0);
  });

  it('fails closed when the plan has no active scoped price', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const planId = await seedPlan({ slug: 'unpriced' });

    await expect(service().subscribeToPlan(userId, planId)).rejects.toMatchObject({
      statusCode: 503,
      code: 'PLAN_MHC_PRICE_MISSING',
    });
    expect(await subscriptionCount(userId)).toBe(0);
    expect(await balanceOf(pool, userId)).toBe(500);
  });

  it('fails closed when the scoped price was deactivated', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const planId = await seedPlan({ slug: 'switched-off' });
    await setPlanPrice(planId, 40);
    await setPlanPrice(planId, null); // deactivate, keeping history

    await expect(service().subscribeToPlan(userId, planId)).rejects.toMatchObject({
      code: 'PLAN_MHC_PRICE_MISSING',
    });
    // The superseded row is retained as history rather than deleted.
    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM mhc_action_price_scopes WHERE scope_id = $1`,
        [planId],
      ),
    ).toBe(1);
  });

  it('refuses a non-purchasable plan before any wallet access', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const planId = await seedPlan({ slug: 'not-for-sale', purchasable: false });
    await setPlanPrice(planId, 40);

    await expect(service().subscribeToPlan(userId, planId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PLAN_NOT_PURCHASABLE',
    });
    expect(await balanceOf(pool, userId)).toBe(500);
    expect(await ledgerCount(userId)).toBe(0);
  });

  it('rolls everything back when the subscription insert fails after charging', async () => {
    const { userId } = await seedProvider(pool, { mhc: 200 });
    const planId = await seedPlan({ slug: 'rollback' });
    await setPlanPrice(planId, 50);

    // Break the subscription insert only: a NOT NULL violation on plan_id forces
    // the domain write to fail after the charge has already succeeded.
    await pool.query(`ALTER TABLE plan_subscriptions ADD COLUMN forced_failure INTEGER NOT NULL`);
    try {
      await expect(service().subscribeToPlan(userId, planId)).rejects.toBeTruthy();
    } finally {
      await pool.query(`ALTER TABLE plan_subscriptions DROP COLUMN forced_failure`);
    }

    expect(await balanceOf(pool, userId)).toBe(200);
    expect(await subscriptionCount(userId)).toBe(0);
    expect(await chargeCount(userId)).toBe(0);
    expect(await ledgerCount(userId)).toBe(0);
  });
});

describe.skipIf(!pgIntegrationEnabled())('concurrency and active-plan rules', () => {
  it('creates one subscription and one charge for ten concurrent identical purchases', async () => {
    const { userId } = await seedProvider(pool, { mhc: 1000 });
    const planId = await seedPlan({ slug: 'race' });
    await setPlanPrice(planId, 40);
    const key = crypto.randomUUID();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => service().subscribeToPlan(userId, planId, key)),
    );

    expect(await subscriptionCount(userId)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    expect(await ledgerCount(userId)).toBe(1);
    expect(await balanceOf(pool, userId)).toBe(960);
    // Every settled caller either bought it or was told it already exists — no
    // caller sees a raw database error.
    const rejected = results.filter((r) => r.status === 'rejected');
    for (const r of rejected) {
      expect(r.reason).toMatchObject({ statusCode: 409 });
    }
  }, 180_000);

  it('refuses a second paid plan while one is active, and permits it after expiry', async () => {
    const { userId } = await seedProvider(pool, { mhc: 1000 });
    const first = await seedPlan({ slug: 'first' });
    const second = await seedPlan({ slug: 'second' });
    await setPlanPrice(first, 30);
    await setPlanPrice(second, 60);

    await service().subscribeToPlan(userId, first);

    await expect(service().subscribeToPlan(userId, second)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PLAN_ALREADY_ACTIVE',
    });
    expect(await subscriptionCount(userId)).toBe(1);
    expect(await balanceOf(pool, userId)).toBe(970);

    // Once it lapses, a different plan may be bought.
    await pool.query(`UPDATE plan_subscriptions SET ends_at = now() - interval '1 day'`);
    const after = await service().subscribeToPlan(userId, second);
    expect(after.mhcCharged).toBe(60);
    expect(await subscriptionCount(userId)).toBe(2);
    // The lapsed subscription is retained, not rewritten.
    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM plan_subscriptions WHERE user_id = $1 AND plan_id = $2`,
        [userId, first],
      ),
    ).toBe(1);
  }, 180_000);

  it('charges nothing when the caller re-buys the plan they are already on', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const planId = await seedPlan({ slug: 'same-again' });
    await setPlanPrice(planId, 25);

    await service().subscribeToPlan(userId, planId);
    const repeat = await service().subscribeToPlan(userId, planId);

    expect(repeat.mhcCharged).toBe(0);
    expect(await subscriptionCount(userId)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    expect(await balanceOf(pool, userId)).toBe(475);
  }, 120_000);
});

describe.skipIf(!pgIntegrationEnabled())('the free plan and entitlements', () => {
  it('needs no price, no charge and no financial row', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM plans WHERE slug = 'free'`);
    const freeId = rows[0]!.id;
    await pool.query(`UPDATE plans SET is_purchasable = true WHERE id = $1`, [freeId]);

    const result = await service().subscribeToPlan(userId, freeId);

    expect(result.mhcCharged).toBe(0);
    expect(result.subscriptionEndsAt).toBeNull();
    expect(await balanceOf(pool, userId)).toBe(100);
    expect(await chargeCount(userId)).toBe(0);
    expect(await ledgerCount(userId)).toBe(0);
    expect(await subscriptionCount(userId)).toBe(0);
  });

  it('cannot cancel a paid subscription that is still running', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const paid = await seedPlan({ slug: 'paid-active' });
    await setPlanPrice(paid, 20);
    await service().subscribeToPlan(userId, paid);

    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM plans WHERE slug = 'free'`);
    await pool.query(`UPDATE plans SET is_purchasable = true WHERE slug = 'free'`);

    await expect(service().subscribeToPlan(userId, rows[0]!.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PLAN_ALREADY_ACTIVE',
    });
    expect(await subscriptionCount(userId)).toBe(1);
  }, 120_000);

  it('still resolves entitlements from an active subscription, then falls back', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const planId = await seedPlan({ slug: 'entitled' });
    await setPlanPrice(planId, 10);
    await pool.query(`UPDATE plans SET plan_limits = $2, max_services = 42 WHERE id = $1`, [
      planId,
      JSON.stringify({ maxActiveBids: 17 }),
    ]);

    await service().subscribeToPlan(userId, planId);

    const limits = await service().getEffectivePlanLimits(userId);
    expect(limits.maxServices).toBe(42);
    expect(limits.maxActiveBids).toBe(17);
    expect(await service().getEffectivePlanSlug(userId)).toBe('entitled');

    // Lapse it: resolution returns to free without any write.
    await pool.query(`UPDATE plan_subscriptions SET ends_at = now() - interval '1 day'`);
    expect(await service().getEffectivePlanSlug(userId)).toBe('free');
  }, 120_000);

  it('hides a non-visible plan from the catalogue but keeps it resolvable', async () => {
    const hidden = await seedPlan({ slug: 'hidden', visible: false });
    await setPlanPrice(hidden, 15);

    const listed = await service().listActivePlansForRole('business');
    expect(listed.map((p) => p.slug)).not.toContain('hidden');

    // Still a real plan: entitlements for an existing subscriber keep working.
    const { rows } = await pool.query<{ c: string }>(
      `SELECT count(*)::text c FROM plans WHERE id = $1 AND is_active = true`,
      [hidden],
    );
    expect(parseInt(rows[0]!.c, 10)).toBe(1);
  });

  it('reports each plan MHC price on the catalogue', async () => {
    const a = await seedPlan({ slug: 'cat-a' });
    const b = await seedPlan({ slug: 'cat-b' });
    await setPlanPrice(a, 11);
    await setPlanPrice(b, 22);

    const listed = await service().listActivePlansForRole('business');
    const byslug = new Map(listed.map((p) => [p.slug, p]));
    expect(byslug.get('cat-a')?.mhcPrice).toBe(11);
    expect(byslug.get('cat-b')?.mhcPrice).toBe(22);
    // An unpriced plan reports null rather than 0, so the UI can tell "free"
    // apart from "not configured".
    expect(byslug.get('free')?.mhcPrice ?? null).toBeNull();
  });
});
