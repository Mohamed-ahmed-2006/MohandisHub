import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { AdminService } from '../modules/admin/admin.service.js';
import { factoryResetSchema, updateUserSchema } from '../modules/admin/admin.validation.js';

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
    expect(
      factoryResetSchema.safeParse({ confirm: 'FACTORY RESET', extra: true }).success,
    ).toBe(false);

    const adminRoutes = readSource('../modules/admin/admin.routes.ts');
    const adminController = readSource('../modules/admin/admin.controller.ts');

    expect(adminRoutes).toContain("requireAdminPermission('super_admin')");
    expect(adminController).toContain('factoryResetSchema');
    expect(adminController).toContain("env.NODE_ENV === 'production'");
    expect(adminController).toContain('!env.ALLOW_FACTORY_RESET');
    expect(adminController).toContain('FACTORY_RESET_DISABLED');
  });
});
