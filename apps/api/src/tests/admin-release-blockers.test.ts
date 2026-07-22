import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { AdminService } from '../modules/admin/admin.service.js';
import {
  adjustBalanceSchema,
  approveManualInstapayDepositSchema,
  factoryResetSchema,
  updateUserSchema,
} from '../modules/admin/admin.validation.js';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('admin release blocker hardening', () => {
  it('rejects crafted primaryRole changes at validation and service boundaries', async () => {
    expect(updateUserSchema.safeParse({ primaryRole: 'business' }).success).toBe(false);

    const repo = { changeUserRole: vi.fn() };
    const service = new AdminService(repo as never, {} as never);
    await expect(
      service.updateUser('user-1', { primaryRole: 'business' } as never),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'PRIMARY_ROLE_CHANGE_DISABLED',
    });
    await expect(service.changeUserRole('user-1', { role: 'business' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'PRIMARY_ROLE_CHANGE_DISABLED',
    });
    expect(repo.changeUserRole).not.toHaveBeenCalled();
  });

  it('requires factory reset confirmation and production opt-in in the API', () => {
    expect(factoryResetSchema.safeParse({ confirm: 'FACTORY RESET' }).success).toBe(true);
    expect(factoryResetSchema.safeParse({}).success).toBe(false);
    expect(factoryResetSchema.safeParse({ confirm: 'FACTORY RESET', extra: true }).success).toBe(
      false,
    );

    const adminRoutes = readSource('../modules/admin/admin.routes.ts');
    const adminController = readSource('../modules/admin/admin.controller.ts');

    expect(adminRoutes).toContain("requireAdminPermission('super_admin')");
    expect(adminController).toContain('factoryResetSchema');
    expect(adminController).toContain("env.NODE_ENV === 'production'");
    expect(adminController).toContain('!env.ALLOW_FACTORY_RESET');
    expect(adminController).toContain('FACTORY_RESET_DISABLED');
  });

  it('prevents delegated admins from mutating administrators and protects the system account', async () => {
    const repo = {
      getUserById: vi.fn().mockResolvedValue({
        id: 'super-1',
        is_admin: true,
        admin_permissions: ['super_admin'],
      }),
    };
    const service = new AdminService(repo as never, {} as never);

    await expect(service.assertUserCanBeManaged('super-1', false)).rejects.toMatchObject({
      statusCode: 403,
      code: 'SUPER_ADMIN_REQUIRED',
    });
    await expect(service.assertUserCanBeManaged('super-1', true)).resolves.toBeUndefined();
    await expect(
      service.assertUserCanBeManaged('00000000-0000-0000-0000-000000000001', true),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'SYSTEM_ACCOUNT_PROTECTED',
    });

    const adminController = readSource('../modules/admin/admin.controller.ts');
    expect(adminController).toContain('assertCanMutateUserAccount(req, input.isActive === false)');
    expect(adminController).toContain('assertCanMutateUserAccount(req, true)');
  });

  it('rejects privileged money writes that cannot fit the EGP database precision', () => {
    const adjustment = (amount: number) => ({
      userId: '11111111-1111-4111-8111-111111111111',
      type: 'adjustment',
      amount,
      description: 'Release audit adjustment',
    });
    const approval = (creditedAmountEgp: number) => ({
      creditedAmountEgp,
      reason: 'Release audit approval',
    });

    expect(adjustBalanceSchema.safeParse(adjustment(125.5)).success).toBe(true);
    expect(approveManualInstapayDepositSchema.safeParse(approval(125.5)).success).toBe(true);

    for (const invalid of [0, -1, 0.001, 10_000_000_000, Number.POSITIVE_INFINITY]) {
      expect(adjustBalanceSchema.safeParse(adjustment(invalid)).success).toBe(false);
      expect(approveManualInstapayDepositSchema.safeParse(approval(invalid)).success).toBe(false);
    }
  });
});
