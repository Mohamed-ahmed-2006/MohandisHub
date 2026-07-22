import { describe, expect, it, vi } from 'vitest';

import { updateSettingsSchema } from '../modules/admin/admin.validation.js';
import { SettingsService } from '../modules/settings/settings.service.js';

describe('deposit settings invariants', () => {
  it('rejects an impossible deposit range supplied in one update', async () => {
    const repo = { get: vi.fn(), update: vi.fn() };
    const service = new SettingsService(repo as never);

    await expect(
      service.updateSettings({ minDepositAmount: 100, maxDepositAmount: 10 }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_DEPOSIT_LIMITS' });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('validates a partial update against the stored counterpart', async () => {
    const repo = {
      get: vi.fn().mockResolvedValue({
        min_deposit_amount: '100',
        max_deposit_amount: '1000',
      }),
      update: vi.fn(),
    };
    const service = new SettingsService(repo as never);

    await expect(service.updateSettings({ maxDepositAmount: 50 })).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_DEPOSIT_LIMITS',
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects deposit thresholds with fractional piastres', () => {
    expect(updateSettingsSchema.safeParse({ minDepositAmount: 10.001 }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ maxDepositAmount: 10.01 }).success).toBe(true);
  });
});
