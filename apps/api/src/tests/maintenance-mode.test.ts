import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { settingsGetMock } = vi.hoisted(() => ({
  settingsGetMock: vi.fn(),
}));

vi.mock('../modules/settings/settings.repository.js', () => ({
  SettingsRepository: vi.fn(function SettingsRepositoryMock() {
    return {
      get: settingsGetMock,
    };
  }),
}));

const makeReq = (path: string, method = 'GET'): Request =>
  ({
    path,
    method,
  }) as Request;

type MockResponse = Response & {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

const makeRes = (): MockResponse =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }) as unknown as MockResponse;

describe('maintenanceMode middleware', () => {
  beforeEach(() => {
    settingsGetMock.mockReset();
    settingsGetMock.mockResolvedValue({
      maintenance_mode: true,
      maintenance_message: null,
    });
  });

  it('only bypasses maintenance for exact auth/status and settings-management routes', async () => {
    const { maintenanceMode } = await import('../middleware/maintenance-mode.js');
    const next = vi.fn();

    await maintenanceMode(makeReq('/auth/login-extra'), makeRes(), next as NextFunction);
    expect(next).not.toHaveBeenCalled();

    next.mockClear();
    await maintenanceMode(makeReq('/admin/settings', 'PATCH'), makeRes(), next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);

    next.mockClear();
    await maintenanceMode(makeReq('/app/status'), makeRes(), next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('blocks admin and notification data routes while maintenance is active', async () => {
    const { maintenanceMode } = await import('../middleware/maintenance-mode.js');
    const next = vi.fn();
    const adminRes = makeRes();
    const notificationsRes = makeRes();

    await maintenanceMode(makeReq('/admin/users'), adminRes, next as NextFunction);
    await maintenanceMode(makeReq('/notifications'), notificationsRes, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(adminRes.status).toHaveBeenCalledWith(503);
    expect(notificationsRes.status).toHaveBeenCalledWith(503);
  });
});
