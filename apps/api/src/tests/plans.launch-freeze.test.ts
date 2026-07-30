import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlansService } from '../modules/plans/plans.service.js';

// ---------------------------------------------------------------------------
// LC-02 / P0-04 — plan subscriptions are frozen for launch.
// ---------------------------------------------------------------------------
// Only the Free plan is available. Paid plans are not purchasable, and the paid
// path is NOT migrated onto MHC: the plan catalogue is multi-tier by design
// (per-plan price, currency, billing_cycle, duration_days) while MHC pricing is
// one price per action key, so charging `subscription_upgrade` would either
// flatten every tier onto one price or need per-plan action keys. Neither was
// approved, so the legacy EGP implementation is fenced rather than rewritten.
//
// What has to hold, and is asserted here:
//   * the endpoint refuses with a DISTINCT, stable code before it touches
//     anything — no wallet read, no wallet lock, no debit, no subscription row;
//   * the legacy implementation is still present and still works when the pause
//     is lifted, so whichever pricing model is chosen starts from working code;
//   * entitlement resolution is untouched — an existing active subscription
//     still grants its plan's limits, and the free fallback still applies.
// ---------------------------------------------------------------------------

const poolQueryMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn(() => ({ query: clientQueryMock, release: releaseMock }));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: poolQueryMock, connect: connectMock }),
  hasDatabaseConfig: () => true,
}));
vi.mock('../config/env.js', () => ({ env: {} }));

/** Every wallet method the legacy subscription path could possibly reach. */
const makeWalletRepo = () => ({
  debitWalletInTransaction: vi.fn(),
  findByUserId: vi.fn(),
  getOrCreateCommissionWallet: vi.fn(),
  creditWithTypeInTransaction: vi.fn(),
});

const makeService = (
  status: Partial<{
    featurePlansEnabled: boolean;
    moneyMovementsPaused: boolean;
    pausePlanSubscriptions: boolean;
  }>,
  walletRepo: ReturnType<typeof makeWalletRepo>,
) =>
  new PlansService(
    {
      getAppStatus: vi.fn().mockResolvedValue({
        featurePlansEnabled: true,
        moneyMovementsPaused: false,
        pausePlanSubscriptions: true,
        ...status,
      }),
    } as never,
    walletRepo as never,
  );

const PAID_PLAN = 'plan-pro';
const FREE_PLAN = 'plan-free';

beforeEach(() => {
  vi.clearAllMocks();
  poolQueryMock.mockReset();
  clientQueryMock.mockReset();
  connectMock.mockClear();
});

describe('subscribing while the launch freeze is on', () => {
  it('refuses a paid plan with 503 PLAN_SUBSCRIPTIONS_PAUSED', async () => {
    const walletRepo = makeWalletRepo();
    const service = makeService({}, walletRepo);

    await expect(service.subscribeToPlan('user-1', PAID_PLAN)).rejects.toMatchObject({
      statusCode: 503,
      code: 'PLAN_SUBSCRIPTIONS_PAUSED',
    });
  });

  it('refuses the free plan too, since the endpoint itself is paused', async () => {
    // Free needs no subscribe call — it is the default users.plan_id and the
    // effective-limits resolver falls back to it — so pausing the endpoint takes
    // nothing away. Refusing uniformly is what keeps the guard ahead of the
    // wallet for every plan rather than only for priced ones.
    const walletRepo = makeWalletRepo();
    const service = makeService({}, walletRepo);

    await expect(service.subscribeToPlan('user-1', FREE_PLAN)).rejects.toMatchObject({
      statusCode: 503,
      code: 'PLAN_SUBSCRIPTIONS_PAUSED',
    });
  });

  it('calls no wallet method at all', async () => {
    const walletRepo = makeWalletRepo();
    const service = makeService({}, walletRepo);

    await expect(service.subscribeToPlan('user-1', PAID_PLAN)).rejects.toBeTruthy();

    expect(walletRepo.findByUserId).not.toHaveBeenCalled();
    expect(walletRepo.debitWalletInTransaction).not.toHaveBeenCalled();
    expect(walletRepo.getOrCreateCommissionWallet).not.toHaveBeenCalled();
    expect(walletRepo.creditWithTypeInTransaction).not.toHaveBeenCalled();
  });

  it('runs no query and opens no transaction, so no wallet row can even be locked', async () => {
    const walletRepo = makeWalletRepo();
    const service = makeService({}, walletRepo);

    await expect(service.subscribeToPlan('user-1', PAID_PLAN)).rejects.toBeTruthy();

    // The guard sits before getPool(), so there is no read, no `SELECT ... FOR
    // UPDATE` on a wallet, and no BEGIN.
    expect(poolQueryMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('inserts no plan_subscriptions row and rewrites no existing one', async () => {
    const walletRepo = makeWalletRepo();
    const service = makeService({}, walletRepo);

    await expect(service.subscribeToPlan('user-1', PAID_PLAN)).rejects.toBeTruthy();

    const allSql = [...poolQueryMock.mock.calls, ...clientQueryMock.mock.calls].map((c) =>
      String(c[0]),
    );
    expect(allSql.some((s) => /INSERT INTO plan_subscriptions/i.test(s))).toBe(false);
    expect(allSql.some((s) => /UPDATE plan_subscriptions/i.test(s))).toBe(false);
    expect(allSql.some((s) => /UPDATE users SET plan_id/i.test(s))).toBe(false);
  });

  it('keeps the pause distinct from a temporary money-movement halt', async () => {
    // Two different situations with two different answers: "paid plans have not
    // launched" versus "money movements are paused right now". Collapsing them
    // would tell a provider to come back later for something that is not coming.
    const walletRepo = makeWalletRepo();

    const paused = makeService({ pausePlanSubscriptions: true }, walletRepo);
    await expect(paused.subscribeToPlan('user-1', PAID_PLAN)).rejects.toMatchObject({
      code: 'PLAN_SUBSCRIPTIONS_PAUSED',
    });

    const moneyHalted = makeService(
      { pausePlanSubscriptions: false, moneyMovementsPaused: true },
      walletRepo,
    );
    await expect(moneyHalted.subscribeToPlan('user-1', PAID_PLAN)).rejects.toMatchObject({
      code: 'MONEY_MOVEMENTS_PAUSED',
    });
  });

  it('still reports a disabled plans feature as FEATURE_DISABLED', async () => {
    const walletRepo = makeWalletRepo();
    const service = makeService({ featurePlansEnabled: false }, walletRepo);
    await expect(service.subscribeToPlan('user-1', PAID_PLAN)).rejects.toMatchObject({
      statusCode: 503,
      code: 'FEATURE_DISABLED',
    });
  });

  it('says nothing about the user losing their current plan', async () => {
    const walletRepo = makeWalletRepo();
    const service = makeService({}, walletRepo);
    await expect(service.subscribeToPlan('user-1', PAID_PLAN)).rejects.toThrow(
      /current plan and its benefits are unchanged/,
    );
  });

  it('reaches the MHC purchase path once the pause is lifted', async () => {
    // Proof that the pause FENCES rather than breaks: with it off, a purchase
    // proceeds — now through the MHC primitive, using the plan's own scoped
    // price, and without touching an EGP wallet.
    const walletRepo = makeWalletRepo();
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ primary_role: 'business' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: PAID_PLAN,
            slug: 'pro',
            name: 'Pro',
            price: '1000',
            currency: 'EGP',
            billing_cycle: 'monthly',
            allowed_roles: ['business'],
            plan_limits: {},
            is_active: true,
            is_purchasable: true,
            is_visible: true,
          },
        ],
      });
    clientQueryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] }) // user lock
      .mockResolvedValueOnce({ rows: [] }) // no active subscription
      .mockResolvedValue({ rows: [] }); // insert, users update, COMMIT

    const mhc = {
      getScopedPrice: vi.fn().mockResolvedValue(40),
      listScopedPrices: vi.fn().mockResolvedValue(new Map()),
      getBalanceFor: vi.fn().mockResolvedValue(60),
      chargeAction: vi.fn().mockResolvedValue({
        outcome: 'charged',
        chargeId: 'cccccccc-0000-4000-8000-00000000000c',
        transactionId: 'tx-1',
        mhcCharged: 40,
        balanceAfter: 60,
        alreadyCharged: false,
      }),
    };

    const service = new PlansService(
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
    const result = await service.subscribeToPlan('user-1', PAID_PLAN);

    expect(result.plan.id).toBe(PAID_PLAN);
    expect(result.mhcCharged).toBe(40);
    expect(mhc.chargeAction).toHaveBeenCalledTimes(1);
    expect(walletRepo.debitWalletInTransaction).not.toHaveBeenCalled();
  });
});

describe('entitlements are untouched by the freeze', () => {
  it('still resolves an existing active subscription to that plan limits', async () => {
    const service = makeService({}, makeWalletRepo());
    poolQueryMock
      // active plan_subscriptions row wins over users.plan_id
      .mockResolvedValueOnce({ rows: [{ plan_id: PAID_PLAN }] })
      .mockResolvedValueOnce({
        rows: [
          {
            max_services: 50,
            max_projects: 20,
            plan_limits: { maxActiveBids: 40, canPriorityListing: true },
          },
        ],
      });

    const limits = await service.getEffectivePlanLimits('subscriber-1');

    expect(limits).toMatchObject({
      maxServices: 50,
      maxJobs: 20,
      maxActiveBids: 40,
      canPriorityListing: true,
    });
  });

  it('still reports an existing subscriber current plan slug', async () => {
    const service = makeService({}, makeWalletRepo());
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ plan_id: PAID_PLAN }] })
      .mockResolvedValueOnce({ rows: [{ slug: 'pro' }] });

    // The freeze stops new purchases; it must not silently downgrade anybody.
    expect(await service.getEffectivePlanSlug('subscriber-1')).toBe('pro');
  });

  it('still falls back to users.plan_id when no subscription is active', async () => {
    const service = makeService({}, makeWalletRepo());
    poolQueryMock
      .mockResolvedValueOnce({ rows: [] }) // no active subscription
      .mockResolvedValueOnce({ rows: [{ plan_id: FREE_PLAN }] }) // users.plan_id
      .mockResolvedValueOnce({ rows: [{ max_services: 3, max_projects: 1, plan_limits: {} }] });

    const limits = await service.getEffectivePlanLimits('free-user');
    expect(limits.maxServices).toBe(3);
  });

  it('still falls back to the free plan when neither is set', async () => {
    const service = makeService({}, makeWalletRepo());
    poolQueryMock
      .mockResolvedValueOnce({ rows: [] }) // no active subscription
      .mockResolvedValueOnce({ rows: [{ plan_id: null }] }) // users.plan_id null
      .mockResolvedValueOnce({ rows: [{ id: FREE_PLAN }] }) // slug = 'free' lookup
      .mockResolvedValueOnce({ rows: [{ max_services: 1, max_projects: 0, plan_limits: {} }] });

    const limits = await service.getEffectivePlanLimits('brand-new-user');
    expect(limits.maxServices).toBe(1);
  });

  it('reports free for a user whose paid subscription has expired', async () => {
    const service = makeService({}, makeWalletRepo());
    poolQueryMock.mockResolvedValueOnce({ rows: [] }); // ends_at > now() matches nothing

    expect(await service.getEffectivePlanSlug('lapsed-user')).toBe('free');
  });
});
