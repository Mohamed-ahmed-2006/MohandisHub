import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlansService } from '../modules/plans/plans.service.js';

const poolQueryMock = vi.fn();
const queryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn(() => ({
  query: queryMock,
  release: releaseMock,
}));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({
    query: poolQueryMock,
    connect: connectMock,
  }),
}));

const makePlan = (overrides: Record<string, unknown> = {}) => ({
  id: 'plan-new',
  slug: 'pro',
  name: 'Pro',
  description: null,
  price: '100',
  currency: 'EGP',
  billing_cycle: 'monthly',
  duration_days: null,
  trial_days: 0,
  features: [],
  allowed_roles: ['business'],
  plan_limits: {},
  is_active: true,
  sort_order: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe('PlansService subscription replacement', () => {
  beforeEach(() => {
    poolQueryMock.mockReset();
    queryMock.mockReset();
    releaseMock.mockReset();
    connectMock.mockClear();
  });

  it('expires a different active plan and charges the full replacement price', async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ primary_role: 'business' }] })
      .mockResolvedValueOnce({ rows: [makePlan()] });
    queryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] }) // user lock
      .mockResolvedValueOnce({
        rows: [{ id: 'sub-old', plan_id: 'plan-old', ends_at: new Date().toISOString() }],
      }) // active subscriptions lock
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-1', balance: '500' }] }) // wallet lock
      .mockResolvedValueOnce({}) // expire old active rows
      .mockResolvedValueOnce({}) // insert new subscription
      .mockResolvedValueOnce({}) // update user plan
      .mockResolvedValueOnce({}); // COMMIT

    const walletRepo = {
      debitWalletInTransaction: vi.fn().mockResolvedValue('tx-1'),
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
    );

    const result = await service.subscribeToPlan('user-1', 'plan-new');

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE plan_subscriptions'),
      expect.arrayContaining(['user-1']),
    );
    expect(walletRepo.debitWalletInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      'wallet-1',
      'user-1',
      100,
      'Plan subscription: Pro',
      'plan_subscription',
      'plan-new',
    );
    expect(result.walletBalance).toBe(400);
    expect(result.plan.id).toBe('plan-new');
  });

  it('does not charge again for the same active plan', async () => {
    const endsAt = new Date(Date.now() + 86_400_000).toISOString();
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ primary_role: 'business' }] })
      .mockResolvedValueOnce({ rows: [makePlan()] });
    queryMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sub-1', plan_id: 'plan-new', ends_at: endsAt }] })
      .mockResolvedValueOnce({ rows: [{ balance: '250' }] })
      .mockResolvedValueOnce({});
    const walletRepo = {
      debitWalletInTransaction: vi.fn(),
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
    );

    const result = await service.subscribeToPlan('user-1', 'plan-new');

    expect(walletRepo.debitWalletInTransaction).not.toHaveBeenCalled();
    expect(result.walletBalance).toBe(250);
    expect(result.subscriptionEndsAt).toBe(endsAt);
  });
});
