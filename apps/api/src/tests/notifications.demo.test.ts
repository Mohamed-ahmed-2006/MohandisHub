import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { env } from '../config/env.js';
import { sendDemo } from '../modules/notifications/notifications.controller.js';
import { NotificationsService } from '../modules/notifications/notifications.service.js';

const originalNodeEnv = env.NODE_ENV;

describe('notifications demo endpoint hardening', () => {
  afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it('blocks demo notification creation in production', async () => {
    env.NODE_ENV = 'production';

    const req = {
      user: { id: 'user-1' },
    } as unknown as Request;
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = {
      status,
      json,
    } as unknown as Response;
    const nextFn = vi.fn();
    const next = nextFn as unknown as NextFunction;

    sendDemo(req, res, next);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(nextFn).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: 'NOT_FOUND',
      }),
    );
    expect(status).not.toHaveBeenCalled();
  });

  it('does not fake notification writes in production when the notifications table is missing', async () => {
    env.NODE_ENV = 'production';
    const missingTableError = Object.assign(new Error('relation "notifications" does not exist'), {
      code: '42P01',
    });
    const repo = {
      create: vi.fn().mockRejectedValue(missingTableError),
    };
    const service = new NotificationsService(repo as never);

    await expect(
      service.createForUser('user-1', {
        type: 'demo',
        title: 'Test',
        message: 'Message',
      }),
    ).rejects.toBe(missingTableError);
  });
});
