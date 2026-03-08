import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { profilesController } from '../modules/profiles/profiles.controller.js';
import { ProfilesService } from '../modules/profiles/profiles.service.js';

describe('admin verification authorization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows users with isAdmin=true even when primary role is not admin', async () => {
    const pendingSpy = vi.spyOn(ProfilesService.prototype, 'getPendingVerifications').mockResolvedValue([]);

    const req = {
      user: {
        id: 'user_1',
        role: 'customer',
        isAdmin: true,
      },
    } as unknown as Request;

    const json = vi.fn();
    const res = { json } as unknown as Response;
    const nextFn = vi.fn();
    const next = nextFn as unknown as NextFunction;

    profilesController.getPendingVerifications(req, res, next);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pendingSpy).toHaveBeenCalledTimes(1);
    expect(nextFn).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ ok: true, data: [] });
  });

  it('rejects users with isAdmin=false', async () => {
    const pendingSpy = vi.spyOn(ProfilesService.prototype, 'getPendingVerifications').mockResolvedValue([]);

    const req = {
      user: {
        id: 'user_2',
        role: 'customer',
        isAdmin: false,
      },
    } as unknown as Request;

    const json = vi.fn();
    const res = { json } as unknown as Response;
    const nextFn = vi.fn();
    const next = nextFn as unknown as NextFunction;

    profilesController.getPendingVerifications(req, res, next);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pendingSpy).not.toHaveBeenCalled();
    expect(nextFn).toHaveBeenCalledTimes(1);
    expect(nextFn.mock.calls[0]![0]).toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });
});
