import { DEFAULT_PLAN_ALLOWED_ROLES } from '@mohandishub/shared';
import { describe, expect, it, vi } from 'vitest';

import { AdminService } from '../modules/admin/admin.service.js';

const createService = () => {
  const repo = {
    listPlans: vi.fn(),
    createPlan: vi.fn(),
    updatePlan: vi.fn(),
    softDeletePlan: vi.fn(),
  };

  const service = new AdminService(repo as never, {} as never);

  return { service, repo };
};

describe('admin plan DB error mapping', () => {
  it('maps schema mismatch to PLAN_SCHEMA_MISMATCH', async () => {
    const { service, repo } = createService();
    repo.createPlan.mockRejectedValue({ code: '42703' });

    await expect(
      service.createPlan({
        slug: 'pro',
        name: 'Pro',
        price: 99,
        currency: 'EGP',
        billingCycle: 'monthly',
        trialDays: 0,
        features: [],
        allowedRoles: [...DEFAULT_PLAN_ALLOWED_ROLES],
        sortOrder: 0,
      }),
    ).rejects.toMatchObject({
      statusCode: 500,
      code: 'PLAN_SCHEMA_MISMATCH',
    });
  });

  it('maps duplicate slug to PLAN_SLUG_EXISTS', async () => {
    const { service, repo } = createService();
    repo.createPlan.mockRejectedValue({ code: '23505' });

    await expect(
      service.createPlan({
        slug: 'pro',
        name: 'Pro',
        price: 99,
        currency: 'EGP',
        billingCycle: 'monthly',
        trialDays: 0,
        features: [],
        allowedRoles: [...DEFAULT_PLAN_ALLOWED_ROLES],
        sortOrder: 0,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PLAN_SLUG_EXISTS',
    });
  });

  it('maps invalid DB constraint to PLAN_INVALID_INPUT', async () => {
    const { service, repo } = createService();
    repo.updatePlan.mockRejectedValue({ code: '23514', constraint: 'plans_billing_cycle_check' });

    await expect(service.updatePlan('plan_1', { billingCycle: 'monthly' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'PLAN_INVALID_INPUT',
    });
  });
});
