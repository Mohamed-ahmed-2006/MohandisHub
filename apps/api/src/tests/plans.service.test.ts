import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlansService } from '../modules/plans/plans.service.js';

// ---------------------------------------------------------------------------
// Plan purchasing, per the approved per-plan MHC pricing decision.
// ---------------------------------------------------------------------------
// This file previously asserted the legacy EGP path: an active plan was
// truncated and replaced, and the caller was debited from the money wallet that
// 20260728160000 froze. Both behaviours are now deliberately gone —
//
//   * EGP plan pricing is retired from every reachable purchase path;
//   * a user with an active paid subscription waits until it expires rather than
//     switching mid-cycle, because prorating and refunds were explicitly ruled
//     out of this task.
//
// so the assertions were rewritten to the decided behaviour rather than kept
// passing against code that no longer exists. Scoped-price resolution,
// concurrency and rollback are covered against real PostgreSQL in
// plans.mhc-pricing.pg.test.ts.
// ---------------------------------------------------------------------------

const poolQueryMock = vi.fn();
const queryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn(() => ({ query: queryMock, release: releaseMock }));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: poolQueryMock, connect: connectMock }),
  hasDatabaseConfig: () => true,
}));
vi.mock('../config/env.js', () => ({ env: {} }));

const PLAN_ID = 'aaaaaaaa-0000-4000-8000-00000000000a';

const makePlan = (overrides: Record<string, unknown> = {}) => ({
  id: PLAN_ID,
  slug: 'pro',
  name: 'Pro',
  description: null,
  price: '1000',
  currency: 'EGP',
  billing_cycle: 'monthly',
  duration_days: null,
  trial_days: 0,
  features: [],
  allowed_roles: ['business'],
  plan_limits: {},
  is_active: true,
  is_purchasable: true,
  is_visible: true,
  sort_order: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const makeMhc = (over: Partial<Record<string, unknown>> = {}) => ({
  getScopedPrice: vi.fn().mockResolvedValue(40),
  listScopedPrices: vi.fn().mockResolvedValue(new Map([[PLAN_ID, 40]])),
  getBalanceFor: vi.fn().mockResolvedValue(60),
  chargeAction: vi.fn().mockResolvedValue({
    outcome: 'charged',
    chargeId: 'cccccccc-0000-4000-8000-00000000000c',
    transactionId: 'tttttttt-0000-4000-8000-00000000000t',
    mhcCharged: 40,
    balanceAfter: 60,
    alreadyCharged: false,
  }),
  ...over,
});

const makeService = (
  mhc: ReturnType<typeof makeMhc>,
  walletRepo: Record<string, unknown> = { debitWalletInTransaction: vi.fn() },
) =>
  new PlansService(
    {
      getAppStatus: vi.fn().mockResolvedValue({
        featurePlansEnabled: true,
        moneyMovementsPaused: false,
        pausePlanSubscriptions: false,
      }),
    } as never,
    walletRepo as never,
    undefined,
    mhc as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  poolQueryMock.mockReset();
  queryMock.mockReset();
  connectMock.mockClear();
});

/** Pool reads: primary_role, then the plan row. */
const primeLookups = (plan = makePlan()) => {
  poolQueryMock
    .mockResolvedValueOnce({ rows: [{ primary_role: 'business' }] })
    .mockResolvedValueOnce({ rows: [plan] });
};

/** Transaction: BEGIN, user lock, active-subscription lock, ... */
const primeTransaction = (activeSubscriptionRows: Array<Record<string, unknown>> = []) => {
  queryMock
    .mockResolvedValueOnce({}) // BEGIN
    .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] }) // user FOR UPDATE
    .mockResolvedValueOnce({ rows: activeSubscriptionRows }) // subscriptions FOR UPDATE
    .mockResolvedValue({ rows: [] }); // insert, users update, COMMIT
};

describe('plan purchase charges MHC from the plan own price', () => {
  it('charges through the primitive with the plan as the price scope', async () => {
    primeLookups();
    primeTransaction();
    const mhc = makeMhc();

    const result = await makeService(mhc).subscribeToPlan('user-1', PLAN_ID);

    expect(mhc.chargeAction).toHaveBeenCalledTimes(1);
    const args = mhc.chargeAction.mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({
      actionKey: 'subscription_upgrade',
      referenceType: 'plan_subscription',
      priceScope: { scopeType: 'plan', scopeId: PLAN_ID },
    });
    // No amount is passed in — the primitive resolves the price itself.
    expect(Object.keys(args)).not.toContain('mhcPrice');
    expect(Object.keys(args)).not.toContain('price');
    expect(result.mhcCharged).toBe(40);
    expect(result.mhcBalance).toBe(60);
  });

  it('reuses the caller transaction for the charge and the subscription insert', async () => {
    primeLookups();
    primeTransaction();
    const mhc = makeMhc();

    await makeService(mhc).subscribeToPlan('user-1', PLAN_ID);

    // The charge got the same client the insert runs on.
    const chargeArgs = mhc.chargeAction.mock.calls[0]![0] as { client: unknown };
    expect(chargeArgs.client).toBeDefined();
    const sql = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sql.filter((s) => /^BEGIN$/.test(s))).toHaveLength(1);
    expect(sql.some((s) => /INSERT INTO plan_subscriptions/.test(s))).toBe(true);
    expect(sql.filter((s) => /^COMMIT$/.test(s))).toHaveLength(1);
  });

  it('snapshots the price, duration and charge on the subscription row', async () => {
    primeLookups();
    primeTransaction();

    await makeService(makeMhc()).subscribeToPlan('user-1', PLAN_ID);

    const insert = queryMock.mock.calls.find((c) =>
      /INSERT INTO plan_subscriptions/.test(String(c[0])),
    );
    expect(insert).toBeDefined();
    const columns = String(insert![0]);
    for (const column of [
      'mhc_price_paid',
      'duration_days_used',
      'action_charge_id',
      'client_idempotency_key',
    ]) {
      expect(columns).toContain(column);
    }
    const values = insert![1] as unknown[];
    expect(values).toContain(40); // price snapshot
    expect(values).toContain(30); // monthly duration
    expect(values).toContain('cccccccc-0000-4000-8000-00000000000c'); // charge id
  });

  it('never reads or debits an EGP wallet', async () => {
    primeLookups();
    primeTransaction();
    const walletRepo = {
      debitWalletInTransaction: vi.fn(),
      findByUserId: vi.fn(),
    };

    await makeService(makeMhc(), walletRepo).subscribeToPlan('user-1', PLAN_ID);

    expect(walletRepo.debitWalletInTransaction).not.toHaveBeenCalled();
    expect(walletRepo.findByUserId).not.toHaveBeenCalled();
    const sql = [...poolQueryMock.mock.calls, ...queryMock.mock.calls].map((c) => String(c[0]));
    expect(sql.some((s) => /FROM wallets/.test(s))).toBe(false);
  });
});

describe('plan purchase refuses before touching money', () => {
  it('rejects a plan that is not purchasable', async () => {
    primeLookups(makePlan({ is_purchasable: false }));
    const mhc = makeMhc();

    await expect(makeService(mhc).subscribeToPlan('user-1', PLAN_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PLAN_NOT_PURCHASABLE',
    });
    expect(mhc.chargeAction).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('fails closed when the plan has no active scoped price', async () => {
    primeLookups();
    const mhc = makeMhc({ getScopedPrice: vi.fn().mockResolvedValue(null) });

    await expect(makeService(mhc).subscribeToPlan('user-1', PLAN_ID)).rejects.toMatchObject({
      statusCode: 503,
      code: 'PLAN_MHC_PRICE_MISSING',
    });
    // An unpriced plan is never given away and never charged a global default.
    expect(mhc.chargeAction).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });
});

describe('an active paid plan blocks a switch', () => {
  const activeUntil = new Date(Date.now() + 86_400_000).toISOString();

  it('refuses a different plan and says when the caller may switch', async () => {
    primeLookups();
    primeTransaction([{ id: 'sub-1', plan_id: 'other-plan', ends_at: activeUntil }]);
    const mhc = makeMhc();

    await expect(makeService(mhc).subscribeToPlan('user-1', PLAN_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PLAN_ALREADY_ACTIVE',
      details: { activeUntil },
    });
    expect(mhc.chargeAction).not.toHaveBeenCalled();
  });

  it('never truncates the subscription the caller already paid for', async () => {
    primeLookups();
    primeTransaction([{ id: 'sub-1', plan_id: 'other-plan', ends_at: activeUntil }]);

    await expect(makeService(makeMhc()).subscribeToPlan('user-1', PLAN_ID)).rejects.toBeTruthy();

    const sql = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => /UPDATE plan_subscriptions/.test(s))).toBe(false);
    expect(sql.some((s) => /^COMMIT$/.test(s))).toBe(false);
  });

  it('charges nothing when the caller is already on this exact plan', async () => {
    primeLookups();
    primeTransaction([{ id: 'sub-1', plan_id: PLAN_ID, ends_at: activeUntil }]);
    const mhc = makeMhc();

    const result = await makeService(mhc).subscribeToPlan('user-1', PLAN_ID);

    expect(mhc.chargeAction).not.toHaveBeenCalled();
    expect(result.mhcCharged).toBe(0);
    expect(result.subscriptionEndsAt).toBe(activeUntil);
  });
});

describe('the free plan', () => {
  const freePlan = makePlan({ slug: 'free', price: '0', is_purchasable: true });

  it('needs no charge and no financial row', async () => {
    primeLookups(freePlan);
    primeTransaction();
    const mhc = makeMhc();

    const result = await makeService(mhc).subscribeToPlan('user-1', PLAN_ID);

    expect(mhc.chargeAction).not.toHaveBeenCalled();
    expect(result.mhcCharged).toBe(0);
    expect(result.subscriptionEndsAt).toBeNull();
    const sql = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => /INSERT INTO plan_subscriptions/.test(s))).toBe(false);
  });

  it('does not need a scoped price configured', async () => {
    primeLookups(freePlan);
    primeTransaction();
    const mhc = makeMhc({ getScopedPrice: vi.fn().mockResolvedValue(null) });

    await expect(makeService(mhc).subscribeToPlan('user-1', PLAN_ID)).resolves.toMatchObject({
      mhcCharged: 0,
    });
    expect(mhc.getScopedPrice).not.toHaveBeenCalled();
  });

  it('cannot cancel a paid subscription that is still running', async () => {
    const activeUntil = new Date(Date.now() + 86_400_000).toISOString();
    primeLookups(freePlan);
    primeTransaction([{ id: 'sub-1', plan_id: 'paid-plan', ends_at: activeUntil }]);

    await expect(makeService(makeMhc()).subscribeToPlan('user-1', PLAN_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PLAN_ALREADY_ACTIVE',
    });
    const sql = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => /UPDATE plan_subscriptions/.test(s))).toBe(false);
  });
});
